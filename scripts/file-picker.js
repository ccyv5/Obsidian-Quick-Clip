// File picker script for Obsidian Web Clipper

// DOM elements
const newFileBtn = document.getElementById('newFileBtn');
const newFileNameInput = document.getElementById('newFileName');
const fileList = document.getElementById('fileList');
const loadingIndicator = document.getElementById('loadingIndicator');
const emptyState = document.getElementById('emptyState');
const cancelBtn = document.getElementById('cancelBtn');

// Store context data
let contextData = null;

/**
 * Initialize the file picker with context data
 */
async function initialize() {
  try {
    // Get context data from background script
    let response;
    try {
      response = await chrome.runtime.sendMessage({ action: 'getPickerContext' });
    } catch (msgError) {
      console.error('Failed to communicate with background script:', msgError);
      showError('无法与后台通信\n请重试');
      setTimeout(() => window.close(), 2000);
      return;
    }
    
    if (!response || !response.success) {
      console.error('Failed to get picker context:', response?.error);
      showError('无法获取上下文数据\n' + (response?.error || '请重试'));
      setTimeout(() => window.close(), 2000);
      return;
    }
    
    contextData = response.data;
    
    // Set default file name from page title
    if (contextData.pageTitle) {
      // Sanitize the title for use as filename
      const sanitizedTitle = sanitizeFileName(contextData.pageTitle);
      newFileNameInput.value = sanitizedTitle;
    } else {
      // Fallback to timestamp-based name
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      newFileNameInput.value = `clip-${timestamp}`;
    }
    
    // Load existing files from the target folder
    await loadExistingFiles();
    
  } catch (error) {
    console.error('Failed to initialize file picker:', error);
    showError('初始化失败\n' + error.message);
    setTimeout(() => window.close(), 2000);
  }
}

/**
 * Sanitize filename by removing invalid characters
 */
function sanitizeFileName(fileName) {
  // Remove invalid filename characters
  return fileName
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100); // Limit length
}

/**
 * Load existing Markdown files from the target folder
 */
async function loadExistingFiles() {
  try {
    loadingIndicator.style.display = 'block';
    fileList.innerHTML = '';
    emptyState.style.display = 'none';
    
    // Request file list from background script
    let response;
    try {
      response = await chrome.runtime.sendMessage({ 
        action: 'getMarkdownFiles'
      });
    } catch (msgError) {
      console.error('Failed to communicate with background script:', msgError);
      throw new Error('无法与后台通信，请重试');
    }
    
    loadingIndicator.style.display = 'none';
    
    if (!response || !response.success) {
      const errorMsg = response?.error || '未知错误';
      console.error('Failed to load files:', errorMsg);
      
      // Provide user-friendly error messages
      if (errorMsg.includes('权限')) {
        emptyState.textContent = '⚠ 文件夹访问权限不足\n请在扩展选项中重新选择文件夹';
      } else if (errorMsg.includes('未配置')) {
        emptyState.textContent = '⚠ 未配置目标文件夹\n请先在扩展选项中配置';
      } else if (errorMsg.includes('不存在')) {
        emptyState.textContent = '⚠ 文件夹不存在\n请在扩展选项中重新选择';
      } else {
        emptyState.textContent = '❌ 加载文件列表失败\n' + errorMsg;
      }
      
      emptyState.style.display = 'block';
      emptyState.style.whiteSpace = 'pre-line';
      emptyState.style.textAlign = 'center';
      return;
    }
    
    const files = response.files || [];
    
    if (files.length === 0) {
      emptyState.textContent = '📝 目标文件夹中暂无Markdown文件';
      emptyState.style.display = 'block';
      return;
    }
    
    // Sort files by last modified time (most recent first)
    files.sort((a, b) => b.lastModified - a.lastModified);
    
    // Render file list
    files.forEach(file => {
      const fileItem = createFileItem(file);
      fileList.appendChild(fileItem);
    });
    
  } catch (error) {
    console.error('Failed to load existing files:', error);
    loadingIndicator.style.display = 'none';
    emptyState.textContent = '❌ 加载文件列表失败\n' + error.message;
    emptyState.style.display = 'block';
    emptyState.style.whiteSpace = 'pre-line';
    emptyState.style.textAlign = 'center';
  }
}

/**
 * Create a file item element
 */
function createFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  
  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  fileName.textContent = file.name;
  
  const fileMeta = document.createElement('div');
  fileMeta.className = 'file-meta';
  fileMeta.textContent = formatDate(file.lastModified);
  
  item.appendChild(fileName);
  item.appendChild(fileMeta);
  
  // Handle file selection
  item.addEventListener('click', () => {
    selectExistingFile(file.name);
  });
  
  return item;
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return '刚刚';
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours}小时前`;
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else {
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }
}

/**
 * Handle new file creation
 */
async function createNewFile() {
  const fileName = newFileNameInput.value.trim();
  
  if (!fileName) {
    showError('请输入文件名');
    newFileNameInput.focus();
    return;
  }
  
  // Validate filename
  const invalidChars = /[<>:"/\\|?*]/g;
  if (invalidChars.test(fileName)) {
    showError('文件名包含非法字符\n不能包含: < > : " / \\ | ? *');
    newFileNameInput.focus();
    return;
  }
  
  // Ensure .md extension
  const fullFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
  
  // Disable button to prevent double-click
  newFileBtn.disabled = true;
  newFileBtn.textContent = '保存中...';
  
  try {
    // Send selection to background script
    const response = await chrome.runtime.sendMessage({
      action: 'saveToFile',
      fileSelection: {
        type: 'new',
        fileName: fullFileName
      }
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || '保存失败');
    }
    
    // Close the picker
    window.close();
    
  } catch (error) {
    console.error('Failed to create new file:', error);
    
    // Re-enable button
    newFileBtn.disabled = false;
    newFileBtn.textContent = '新建文件';
    
    // Show user-friendly error
    let errorMsg = '创建文件失败';
    if (error.message) {
      if (error.message.includes('权限')) {
        errorMsg = '没有权限创建文件\n请在扩展选项中重新选择文件夹';
      } else if (error.message.includes('空间')) {
        errorMsg = '磁盘空间不足\n请清理磁盘空间后重试';
      } else if (error.message.includes('占用')) {
        errorMsg = '文件被占用\n请关闭文件后重试';
      } else {
        errorMsg = '创建文件失败\n' + error.message;
      }
    }
    
    showError(errorMsg);
  }
}

/**
 * Handle existing file selection
 */
async function selectExistingFile(fileName) {
  // Disable all file items to prevent double-click
  const fileItems = document.querySelectorAll('.file-item');
  fileItems.forEach(item => {
    item.style.pointerEvents = 'none';
    item.style.opacity = '0.6';
  });
  
  try {
    // Send selection to background script
    const response = await chrome.runtime.sendMessage({
      action: 'saveToFile',
      fileSelection: {
        type: 'existing',
        fileName: fileName
      }
    });
    
    if (!response || !response.success) {
      throw new Error(response?.error || '保存失败');
    }
    
    // Close the picker
    window.close();
    
  } catch (error) {
    console.error('Failed to select file:', error);
    
    // Re-enable file items
    fileItems.forEach(item => {
      item.style.pointerEvents = 'auto';
      item.style.opacity = '1';
    });
    
    // Show user-friendly error
    let errorMsg = '追加内容失败';
    if (error.message) {
      if (error.message.includes('权限')) {
        errorMsg = '没有权限访问文件\n请在扩展选项中重新选择文件夹';
      } else if (error.message.includes('不存在')) {
        errorMsg = '文件不存在\n请刷新文件列表';
      } else if (error.message.includes('空间')) {
        errorMsg = '磁盘空间不足\n请清理磁盘空间后重试';
      } else if (error.message.includes('占用')) {
        errorMsg = '文件被占用\n请关闭文件后重试';
      } else {
        errorMsg = '追加内容失败\n' + error.message;
      }
    }
    
    showError(errorMsg);
  }
}

/**
 * Show error message
 */
function showError(message) {
  alert(message);
}

/**
 * Handle cancel action
 */
function handleCancel() {
  window.close();
}

// Event listeners
newFileBtn.addEventListener('click', createNewFile);

// Allow Enter key to create new file
newFileNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    createNewFile();
  }
});

cancelBtn.addEventListener('click', handleCancel);

// Initialize on load
document.addEventListener('DOMContentLoaded', initialize);
