// Background Service Worker for Obsidian Quick Clip

// Configuration keys for Chrome Storage
const CONFIG_KEYS = {
  PREFIX_TEXT: 'prefixText',
  SUFFIX_TEXT: 'suffixText',
  ADD_TIMESTAMP: 'addTimestamp',
  APPEND_ON_CONFLICT: 'appendOnConflict',
  IMAGE_MODE: 'imageMode',
  QUICK_SAVE_MODE: 'quickSaveMode'
};

// Store context data for file picker
let pickerContext = null;

// Store file list for menu click handling
let menuFileList = [];

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Obsidian Quick Clip installed/updated', details.reason);
  
  // Initialize default configuration if not exists
  await initializeConfig();
  
  // Create context menu
  await createContextMenu();
  console.log('Extension initialization complete');
});

// Initialize default configuration
async function initializeConfig() {
  try {
    const config = await chrome.storage.local.get([
      CONFIG_KEYS.PREFIX_TEXT,
      CONFIG_KEYS.SUFFIX_TEXT
    ]);
    
    // Set default values if not configured
    const updates = {};
    
    if (config[CONFIG_KEYS.PREFIX_TEXT] === undefined) {
      updates[CONFIG_KEYS.PREFIX_TEXT] = '';
    }
    
    if (config[CONFIG_KEYS.SUFFIX_TEXT] === undefined) {
      updates[CONFIG_KEYS.SUFFIX_TEXT] = '';
    }
    
    if (config[CONFIG_KEYS.ADD_TIMESTAMP] === undefined) {
      updates[CONFIG_KEYS.ADD_TIMESTAMP] = false; // 默认关闭时间戳
    }
    
    if (config[CONFIG_KEYS.APPEND_ON_CONFLICT] === undefined) {
      updates[CONFIG_KEYS.APPEND_ON_CONFLICT] = true; // 默认开启同名文件追加
    }
    
    if (config[CONFIG_KEYS.IMAGE_MODE] === undefined) {
      updates[CONFIG_KEYS.IMAGE_MODE] = 'url'; // 默认使用URL链接
    }
    
    if (config[CONFIG_KEYS.QUICK_SAVE_MODE] === undefined) {
      updates[CONFIG_KEYS.QUICK_SAVE_MODE] = true; // 默认开启快速保存
    }
    
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('Default configuration initialized:', updates);
    }
  } catch (error) {
    console.error('Failed to initialize configuration:', error);
  }
}

// Create context menu for saving content
async function createContextMenu() {
  console.log('=== Creating context menu ===');
  
  // Remove all existing menus first
  try {
    await chrome.contextMenus.removeAll();
    console.log('Existing menus removed');
  } catch (error) {
    console.error('Failed to remove existing menus:', error);
  }
  
  // Get configuration to check quick save mode
  const config = await getConfig();
  console.log('Config loaded:', config);
  
  if (config.quickSaveMode) {
    // Quick save mode: create parent menu with file list as submenus
    chrome.contextMenus.create({
      id: 'saveToObsidian',
      title: '保存到Obsidian',
      contexts: ['selection']
    });
    
    // Add "New File" submenu
    chrome.contextMenus.create({
      id: 'newFile',
      parentId: 'saveToObsidian',
      title: '📝 新建文件...',
      contexts: ['selection']
    });
    
    // Add separator
    chrome.contextMenus.create({
      id: 'separator',
      parentId: 'saveToObsidian',
      type: 'separator',
      contexts: ['selection']
    });
    
    // Try to load and add existing files
    let files = [];
    try {
      console.log('Loading markdown files for context menu...');
      files = await getMarkdownFileList();
      console.log(`Loaded ${files ? files.length : 0} files for menu`);
    } catch (error) {
      console.error('Failed to load files for menu:', error);
      files = []; // Use empty array on error
    }
    
    if (files && files.length > 0) {
      // Sort by last modified (most recent first)
      files.sort((a, b) => b.lastModified - a.lastModified);
      
      // Add up to 10 most recent files
      const filesToShow = files.slice(0, 10);
      
      filesToShow.forEach((file, index) => {
        try {
          chrome.contextMenus.create({
            id: `file_${index}`,
            parentId: 'saveToObsidian',
            title: file.name,
            contexts: ['selection']
          });
        } catch (menuError) {
          console.error(`Failed to create menu for file ${file.name}:`, menuError);
        }
      });
      
      if (files.length > 10) {
        chrome.contextMenus.create({
          id: 'moreFiles',
          parentId: 'saveToObsidian',
          title: `... 还有 ${files.length - 10} 个文件`,
          contexts: ['selection'],
          enabled: false
        });
      }
    } else {
      chrome.contextMenus.create({
        id: 'noFiles',
        parentId: 'saveToObsidian',
        title: '(暂无文件)',
        contexts: ['selection'],
        enabled: false
      });
    }
    
    console.log('Quick save context menu created with file list');
  } else {
    // Traditional mode: single menu item
    chrome.contextMenus.create({
      id: 'saveToObsidian',
      title: '保存到Obsidian',
      contexts: ['selection']
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to create context menu:', chrome.runtime.lastError);
      } else {
        console.log('Traditional context menu created successfully');
      }
    });
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);
  
  try {
    if (info.menuItemId === 'saveToObsidian') {
      // Traditional mode: open file picker
      await handleSaveContent(info, tab);
    } else if (info.menuItemId === 'newFile') {
      // Quick save mode: new file
      await handleSaveContent(info, tab, { quickSave: true, fileType: 'new' });
    } else if (info.menuItemId.startsWith('file_')) {
      // Quick save mode: existing file
      const fileIndex = parseInt(info.menuItemId.replace('file_', ''));
      await handleSaveContent(info, tab, { quickSave: true, fileType: 'existing', fileIndex });
    }
  } catch (error) {
    console.error('Error in context menu handler:', error);
    showErrorNotification('操作失败', error.message);
  }
});

// Handle save content request
async function handleSaveContent(info, tab, quickSaveOptions = null) {
  try {
    // Check if folder is configured
    const config = await getConfig();
    
    // Verify folder handle is accessible from IndexedDB
    let folderHandle;
    try {
      folderHandle = await getFolderHandle();
      if (!folderHandle) {
        // No folder configured
        showWarningNotification(
          '未配置目标文件夹',
          '请先在扩展选项中配置目标文件夹'
        );
        chrome.runtime.openOptionsPage();
        return;
      }
      
      // Check permission
      const permission = await folderHandle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        throw new Error('需要重新授权文件夹访问权限');
      }
    } catch (permError) {
      console.error('Folder access error:', permError);
      showErrorNotification(
        '文件夹访问失败',
        '请在扩展选项中重新选择目标文件夹'
      );
      chrome.runtime.openOptionsPage();
      return;
    }
    
    // Get selected content from content script
    let response;
    try {
      // First attempt to send message
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getSelection'
      });
    } catch (msgError) {
      console.error('Failed to communicate with content script:', msgError);
      
      // Check if it's a connection error (content script not loaded)
      if (msgError.message && msgError.message.includes('Receiving end does not exist')) {
        // Try to inject content script manually and retry
        console.log('Content script not loaded, attempting manual injection...');
        
        try {
          // Check if the URL is injectable
          if (tab.url.startsWith('chrome://') || 
              tab.url.startsWith('about:') || 
              tab.url.startsWith('chrome-extension://') ||
              tab.url.startsWith('edge://')) {
            showErrorNotification(
              '不支持的页面',
              '无法在浏览器内部页面使用此功能'
            );
            return;
          }
          
          // Inject content script
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['scripts/content.js']
          });
          
          console.log('Content script injected, retrying...');
          
          // Wait a bit for script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Retry sending message
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'getSelection'
          });
          
        } catch (injectError) {
          console.error('Failed to inject content script:', injectError);
          showErrorNotification(
            '无法注入内容脚本',
            '请刷新页面后重试'
          );
          return;
        }
      } else {
        showErrorNotification(
          '无法获取选中内容',
          '请刷新页面后重试'
        );
        return;
      }
    }
    
    if (!response || (!response.text && !response.images?.length)) {
      showWarningNotification(
        '未检测到选中内容',
        '请选择文本或图片后再试'
      );
      return;
    }
    
    console.log('Selected content received:', response);
    
    // Store context data for file picker
    pickerContext = {
      selectedContent: response,
      pageUrl: tab.url,
      pageTitle: tab.title,
      config: config
    };
    
    // Handle quick save mode
    if (quickSaveOptions) {
      if (quickSaveOptions.fileType === 'new') {
        // Quick save to new file: use page title as filename
        const fileName = sanitizeFileName(tab.title || 'untitled');
        await handleFileSave({
          type: 'new',
          fileName: fileName
        });
      } else if (quickSaveOptions.fileType === 'existing') {
        // Quick save to existing file
        try {
          const files = await getMarkdownFileList();
          files.sort((a, b) => b.lastModified - a.lastModified);
          const selectedFile = files[quickSaveOptions.fileIndex];
          
          if (selectedFile) {
            await handleFileSave({
              type: 'existing',
              fileName: selectedFile.name
            });
          } else {
            showErrorNotification('文件不存在', '请刷新后重试');
          }
        } catch (error) {
          console.error('Failed to get file for quick save:', error);
          showErrorNotification('保存失败', '无法获取文件信息');
        }
      }
      return;
    }
    
    // Open file picker (popup or side panel based on config)
    try {
      if (config.quickSaveMode) {
        // Quick save mode: menu already shows files, shouldn't reach here
        // But if it does, open side panel as fallback
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } else {
        // Traditional mode: open popup window
        await chrome.windows.create({
          url: chrome.runtime.getURL('file-picker.html'),
          type: 'popup',
          width: 450,
          height: 600
        });
      }
    } catch (openError) {
      console.error('Failed to open file picker:', openError);
      showErrorNotification(
        '无法打开文件选择器',
        '请重试或检查浏览器设置'
      );
    }
    
  } catch (error) {
    console.error('Failed to save content:', error);
    showErrorNotification('保存失败', getErrorMessage(error));
  }
}

// Get configuration from Chrome Storage
async function getConfig() {
  try {
    const config = await chrome.storage.local.get([
      'folderName',
      CONFIG_KEYS.PREFIX_TEXT,
      CONFIG_KEYS.SUFFIX_TEXT,
      CONFIG_KEYS.ADD_TIMESTAMP,
      CONFIG_KEYS.APPEND_ON_CONFLICT,
      CONFIG_KEYS.IMAGE_MODE,
      CONFIG_KEYS.QUICK_SAVE_MODE
    ]);
    
    return {
      folderName: config.folderName || null,
      prefixText: config[CONFIG_KEYS.PREFIX_TEXT] || '',
      suffixText: config[CONFIG_KEYS.SUFFIX_TEXT] || '',
      addTimestamp: config[CONFIG_KEYS.ADD_TIMESTAMP] === true,
      appendOnConflict: config[CONFIG_KEYS.APPEND_ON_CONFLICT] !== false, // 默认true
      imageMode: config[CONFIG_KEYS.IMAGE_MODE] || 'url', // 默认url
      quickSaveMode: config[CONFIG_KEYS.QUICK_SAVE_MODE] !== false // 默认true
    };
  } catch (error) {
    console.error('Failed to get configuration:', error);
    return {
      folderName: null,
      prefixText: '',
      suffixText: '',
      addTimestamp: false,
      appendOnConflict: true, // 默认开启
      imageMode: 'url', // 默认URL模式
      quickSaveMode: true // 默认开启快速保存
    };
  }
}

// Listen for messages from content scripts or other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received in background:', request);
  
  // Handle different message types
  if (request.action === 'getConfig') {
    // Return configuration to requester
    getConfig().then(config => {
      sendResponse({ success: true, config });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'saveConfig') {
    // Save configuration
    chrome.storage.local.set(request.config).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'getPickerContext') {
    // Return picker context data
    if (pickerContext) {
      sendResponse({ success: true, data: pickerContext });
    } else {
      sendResponse({ success: false, error: 'No context data available' });
    }
    return false;
  }
  
  if (request.action === 'getMarkdownFiles') {
    // Get list of Markdown files from target folder
    getMarkdownFileList()
      .then(files => {
        sendResponse({ success: true, files });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'saveToFile') {
    // Handle file save request from picker
    handleFileSave(request.fileSelection)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'refreshMenu') {
    // User right-clicked on selection, refresh menu
    console.log('Received menu refresh request');
    getConfig().then(config => {
      if (config.quickSaveMode) {
        console.log('Refreshing context menu...');
        createContextMenu().catch(error => {
          console.error('Failed to refresh menu:', error);
        });
      }
    });
    return false; // Don't need to send response
  }
  
  return false;
});

/**
 * Get folder handle from IndexedDB
 */
async function getFolderHandle() {
  return new Promise((resolve, reject) => {
    let request;
    
    try {
      request = indexedDB.open('ObsidianClipperDB', 1);
    } catch (error) {
      reject(new Error('无法访问本地数据库: ' + error.message));
      return;
    }
    
    request.onerror = () => {
      const error = request.error;
      console.error('IndexedDB error:', error);
      reject(new Error('数据库访问失败: ' + (error?.message || '未知错误')));
    };
    
    request.onsuccess = () => {
      const db = request.result;
      
      if (!db.objectStoreNames.contains('folderHandles')) {
        resolve(null);
        return;
      }
      
      try {
        const transaction = db.transaction(['folderHandles'], 'readonly');
        const store = transaction.objectStore('folderHandles');
        const getRequest = store.get('targetFolder');
        
        getRequest.onsuccess = () => {
          if (getRequest.result && getRequest.result.handle) {
            resolve(getRequest.result.handle);
          } else {
            resolve(null);
          }
        };
        
        getRequest.onerror = () => {
          console.error('Failed to retrieve folder handle:', getRequest.error);
          reject(new Error('无法读取文件夹配置'));
        };
        
        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          reject(new Error('数据库事务失败'));
        };
      } catch (error) {
        console.error('Transaction creation error:', error);
        reject(new Error('数据库操作失败: ' + error.message));
      }
    };
    
    request.onupgradeneeded = (event) => {
      try {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('folderHandles')) {
          db.createObjectStore('folderHandles', { keyPath: 'id' });
        }
      } catch (error) {
        console.error('Database upgrade error:', error);
        reject(new Error('数据库初始化失败: ' + error.message));
      }
    };
  });
}

/**
 * Get list of Markdown files from target folder
 */
async function getMarkdownFileList() {
  console.log('=== Getting markdown file list ===');
  try {
    const folderHandle = await getFolderHandle();
    console.log('Folder handle retrieved:', folderHandle ? 'Yes' : 'No');
    
    if (!folderHandle) {
      console.warn('No folder handle configured');
      throw new Error('未配置目标文件夹');
    }
    
    // Verify permission
    let permission;
    try {
      permission = await folderHandle.queryPermission({ mode: 'readwrite' });
    } catch (permError) {
      console.error('Permission query error:', permError);
      throw new Error('无法检查文件夹权限，请重新选择文件夹');
    }
    
    if (permission !== 'granted') {
      try {
        const requestPermission = await folderHandle.requestPermission({ mode: 'readwrite' });
        if (requestPermission !== 'granted') {
          throw new Error('文件夹访问权限被拒绝');
        }
      } catch (reqError) {
        console.error('Permission request error:', reqError);
        throw new Error('无法获取文件夹访问权限');
      }
    }
    
    const files = [];
    
    try {
      console.log('Starting to iterate folder contents...');
      // Iterate through folder contents (only current directory, not subdirectories)
      for await (const entry of folderHandle.values()) {
        try {
          // Only process files (skip directories)
          if (entry.kind !== 'file') {
            continue;
          }
          
          // Only process .md files
          if (!entry.name.endsWith('.md')) {
            continue;
          }
          
          // Try to get file metadata
          try {
            const file = await entry.getFile();
            files.push({
              name: entry.name,
              lastModified: file.lastModified
            });
          } catch (fileError) {
            // Skip this file if we can't read it
            console.warn(`Cannot read file ${entry.name}, skipping:`, fileError);
            continue;
          }
        } catch (entryError) {
          // Skip entries that can't be accessed
          console.warn(`Skipping entry:`, entryError);
          continue;
        }
      }
      
      console.log(`Found ${files.length} markdown files in current directory`);
    } catch (iterError) {
      console.error('Error iterating folder:', iterError);
      // Return empty array instead of throwing error
      console.warn('Returning empty file list due to iteration error');
      return [];
    }
    
    return files;
    
  } catch (error) {
    console.error('Failed to get markdown file list:', error);
    throw new Error(getErrorMessage(error));
  }
}

/**
 * Convert HTML content to Markdown, preserving image positions
 * 
 * @param {string} html - HTML content
 * @param {Array<{src: string, alt: string}>} images - Array of image objects
 * @returns {string} Markdown content with images in original positions
 */
function convertHtmlToMarkdown(html, images) {
  let content = html;
  
  // Replace <img> tags with Markdown image syntax
  // Match: <img src="..." alt="..." ...> or <img alt="..." src="..." ...>
  content = content.replace(/<img[^>]*>/gi, (imgTag) => {
    // Extract src attribute
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const src = srcMatch ? srcMatch[1] : '';
    
    // Extract alt attribute
    const altMatch = imgTag.match(/alt=["']([^"']+)["']/i);
    const alt = altMatch ? altMatch[1] : '';
    
    if (!src) return ''; // Skip if no src
    
    // Find the absolute URL from our images array
    const imageInfo = images.find(i => 
      i.src === src || 
      i.src.includes(src) || 
      src.includes(i.src.split('/').pop())
    );
    const absoluteSrc = imageInfo ? imageInfo.src : src;
    
    // Return Markdown image syntax
    return `![${alt}](${absoluteSrc})`;
  });
  
  // Remove HTML tags but keep the text content
  content = content.replace(/<br\s*\/?>/gi, '\n'); // Convert <br> to newline
  content = content.replace(/<\/p>/gi, '\n\n'); // Convert </p> to double newline
  content = content.replace(/<[^>]+>/g, ''); // Remove all other HTML tags
  
  // Decode HTML entities
  content = content
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up extra whitespace while preserving paragraph breaks
  content = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n\n');
  
  return content;
}

/**
 * Format content as Obsidian-compatible Markdown
 * 
 * @param {string} pageUrl - The URL of the web page
 * @param {string} pageTitle - The title of the web page
 * @param {string} prefixText - Custom prefix text from user configuration
 * @param {Object} selectedContent - The selected content object with text, html, and images
 * @param {string} suffixText - Custom suffix text from user configuration
 * @returns {string} Formatted Markdown content
 */
function formatMarkdownContent(pageUrl, pageTitle, prefixText, selectedContent, suffixText) {
  const parts = [];
  
  // 1. Add URL in Markdown link format
  // Format: [Page Title](URL)
  if (pageUrl) {
    const urlLine = pageTitle 
      ? `[${pageTitle}](${pageUrl})`
      : pageUrl;
    parts.push(urlLine);
  }
  
  // 2. Add custom prefix text if provided
  if (prefixText && prefixText.trim()) {
    parts.push(prefixText.trim());
  }
  
  // 3. Add selected content
  if (selectedContent) {
    let content = '';
    
    // Check if we have HTML content with images
    if (selectedContent.html && selectedContent.html.trim() && 
        selectedContent.images && selectedContent.images.length > 0) {
      // Convert HTML to Markdown-like format, preserving image positions
      content = convertHtmlToMarkdown(selectedContent.html, selectedContent.images);
    }
    // Use text content if no HTML or no images
    else if (selectedContent.text && selectedContent.text.trim()) {
      content = selectedContent.text.trim();
      
      // Add images at the end if we only have text
      if (selectedContent.images && selectedContent.images.length > 0) {
        const imageParts = selectedContent.images.map(img => {
          return `![${img.alt || ''}](${img.src})`;
        });
        content += '\n\n' + imageParts.join('\n\n');
      }
    }
    // Fallback to HTML if text is not available
    else if (selectedContent.html && selectedContent.html.trim()) {
      content = selectedContent.html.trim();
    }
    
    if (content) {
      parts.push(content);
    }
  }
  
  // 4. Add custom suffix text if provided
  if (suffixText && suffixText.trim()) {
    parts.push(suffixText.trim());
  }
  
  // Join all parts with double newlines for proper Markdown separation
  // This ensures each section is visually separated in Obsidian
  return parts.join('\n\n');
}

/**
 * Replace image URLs with Obsidian-style local references
 * 
 * @param {string} markdownContent - The markdown content with image URLs
 * @param {Array<{originalUrl: string, fileName: string, success: boolean}>} imageResults - Array of image processing results
 * @returns {string} Markdown content with local image references
 */
function replaceImageReferences(markdownContent, imageResults) {
  let updatedContent = markdownContent;
  
  // Replace each successfully saved image URL with Obsidian format: ![[images/filename.ext]]
  imageResults.forEach(result => {
    if (result.success && result.fileName) {
      // Escape special regex characters in the URL
      const escapedUrl = escapeRegExp(result.originalUrl);
      
      // Match ![alt](url) pattern
      const urlPattern = new RegExp(
        `!\\[([^\\]]*)\\]\\(${escapedUrl}\\)`,
        'g'
      );
      
      // Replace with Obsidian wiki-link format
      // This maintains the image position in the content
      updatedContent = updatedContent.replace(
        urlPattern,
        `![[images/${result.fileName}]]`
      );
      
      console.log(`Replaced image reference: ${result.originalUrl} -> ![[images/${result.fileName}]]`);
    } else {
      // If image download/save failed, keep the original URL
      console.warn(`Keeping original URL for failed image: ${result.originalUrl}`);
    }
  });
  
  return updatedContent;
}

/**
 * Escape special characters for use in RegExp
 * 
 * @param {string} string - String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate image URL for security
 * 
 * @param {string} url - Image URL to validate
 * @returns {boolean} True if URL is valid and safe
 */
function validateImageUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      console.warn('Invalid protocol for image URL:', urlObj.protocol);
      return false;
    }
    
    // Check for valid hostname (not empty)
    if (!urlObj.hostname) {
      console.warn('Invalid hostname for image URL');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Invalid image URL:', url, error);
    return false;
  }
}

/**
 * Generate unique filename for image
 * 
 * @param {string} originalUrl - Original image URL
 * @param {number} index - Index of the image in the list
 * @returns {string} Unique filename with extension
 */
function generateImageFileName(originalUrl, index) {
  try {
    const urlObj = new URL(originalUrl);
    const pathname = urlObj.pathname;
    
    // Extract extension from URL
    const extensionMatch = pathname.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : 'png';
    
    // Validate extension (only allow common image formats)
    const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'];
    const finalExtension = validExtensions.includes(extension) ? extension : 'png';
    
    // Generate unique filename using timestamp and index
    const timestamp = Date.now();
    const fileName = `image-${timestamp}-${index}.${finalExtension}`;
    
    return fileName;
  } catch (error) {
    console.error('Failed to generate filename:', error);
    // Fallback to simple naming
    return `image-${Date.now()}-${index}.png`;
  }
}

/**
 * Download image from URL
 * 
 * @param {string} imageUrl - URL of the image to download
 * @param {number} index - Index of the image in the list
 * @returns {Promise<{blob: Blob, fileName: string, originalUrl: string}>} Downloaded image data
 */
async function downloadImage(imageUrl, index) {
  try {
    // Validate URL
    if (!validateImageUrl(imageUrl)) {
      throw new Error(`无效的图片URL`);
    }
    
    console.log(`Downloading image ${index + 1}:`, imageUrl);
    
    // Download image using fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    let response;
    try {
      response = await fetch(imageUrl, { signal: controller.signal });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('下载超时（30秒）');
      }
      throw new Error('网络错误: ' + fetchError.message);
    }
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('图片不存在（404）');
      } else if (response.status === 403) {
        throw new Error('访问被拒绝（403）');
      } else if (response.status >= 500) {
        throw new Error('服务器错误（' + response.status + '）');
      }
      throw new Error(`HTTP错误 ${response.status}`);
    }
    
    // Check content type
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      console.warn(`Unexpected content type for image: ${contentType}`);
      // Continue anyway, as some servers may not set correct content-type
    }
    
    // Get image data as blob
    let blob;
    try {
      blob = await response.blob();
    } catch (blobError) {
      throw new Error('无法读取图片数据');
    }
    
    // Validate blob size (skip if too large, e.g., > 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (blob.size > maxSize) {
      throw new Error(`图片过大: ${(blob.size / 1024 / 1024).toFixed(2)}MB（最大10MB）`);
    }
    
    if (blob.size === 0) {
      throw new Error('图片为空');
    }
    
    // Generate unique filename
    const fileName = generateImageFileName(imageUrl, index);
    
    console.log(`Image downloaded successfully: ${fileName} (${(blob.size / 1024).toFixed(2)}KB)`);
    
    return {
      blob,
      fileName,
      originalUrl: imageUrl
    };
    
  } catch (error) {
    console.error(`Failed to download image from ${imageUrl}:`, error);
    // Re-throw with user-friendly message
    throw error;
  }
}

/**
 * Get or create images subfolder
 * 
 * @param {FileSystemDirectoryHandle} folderHandle - Parent folder handle
 * @returns {Promise<FileSystemDirectoryHandle>} Images subfolder handle
 */
async function getOrCreateImagesFolder(folderHandle) {
  try {
    // Try to get existing images folder
    const imagesFolderHandle = await folderHandle.getDirectoryHandle('images', { create: true });
    console.log('Images folder ready');
    return imagesFolderHandle;
  } catch (error) {
    console.error('Failed to get/create images folder:', error);
    
    // Provide specific error messages
    if (error.name === 'NotAllowedError') {
      throw new Error('没有权限创建images文件夹');
    } else if (error.name === 'NotFoundError') {
      throw new Error('目标文件夹不存在');
    } else if (error.name === 'TypeMismatchError') {
      throw new Error('images已存在但不是文件夹');
    }
    
    throw new Error('无法访问images文件夹: ' + error.message);
  }
}

/**
 * Save image blob to file system
 * 
 * @param {FileSystemDirectoryHandle} imagesFolderHandle - Images folder handle
 * @param {string} fileName - Name of the file to save
 * @param {Blob} blob - Image blob data
 * @returns {Promise<void>}
 */
async function saveImageToFile(imagesFolderHandle, fileName, blob) {
  try {
    // Create file handle
    const fileHandle = await imagesFolderHandle.getFileHandle(fileName, { create: true });
    
    // Create writable stream
    const writable = await fileHandle.createWritable();
    
    try {
      // Write blob to file
      await writable.write(blob);
      
      // Close the stream
      await writable.close();
      
      console.log(`Image saved: ${fileName}`);
    } catch (writeError) {
      // Try to close the stream on error
      try {
        await writable.close();
      } catch (closeError) {
        console.error('Failed to close writable stream:', closeError);
      }
      throw writeError;
    }
  } catch (error) {
    console.error(`Failed to save image ${fileName}:`, error);
    
    // Provide specific error messages
    if (error.name === 'NotAllowedError') {
      throw new Error('没有权限保存图片');
    } else if (error.name === 'QuotaExceededError') {
      throw new Error('磁盘空间不足');
    } else if (error.name === 'NoModificationAllowedError') {
      throw new Error('文件被占用或只读');
    }
    
    throw new Error('保存图片失败: ' + error.message);
  }
}

/**
 * Download and save multiple images in parallel
 * 
 * @param {Array<{src: string, alt: string}>} images - Array of image objects
 * @param {FileSystemDirectoryHandle} folderHandle - Target folder handle
 * @returns {Promise<Array<{originalUrl: string, fileName: string, success: boolean, error?: string}>>} Results for each image
 */
async function downloadAndSaveImages(images, folderHandle) {
  if (!images || images.length === 0) {
    console.log('No images to download');
    return [];
  }
  
  console.log(`Starting batch download of ${images.length} images`);
  
  let imagesFolderHandle;
  
  try {
    // Get or create images subfolder
    imagesFolderHandle = await getOrCreateImagesFolder(folderHandle);
  } catch (folderError) {
    console.error('Failed to access images folder:', folderError);
    // Return all images as failed
    return images.map(img => ({
      originalUrl: img.src,
      fileName: null,
      success: false,
      error: '无法访问images文件夹: ' + folderError.message
    }));
  }
  
  // Download all images in parallel using Promise.allSettled
  // This allows some downloads to fail without stopping others
  const downloadPromises = images.map((image, index) => 
    downloadImage(image.src, index)
  );
  
  const downloadResults = await Promise.allSettled(downloadPromises);
  
  // Save all successfully downloaded images
  const saveResults = [];
  
  for (let i = 0; i < downloadResults.length; i++) {
    const result = downloadResults[i];
    const originalUrl = images[i].src;
    
    if (result.status === 'fulfilled') {
      try {
        // Save the image
        await saveImageToFile(
          imagesFolderHandle,
          result.value.fileName,
          result.value.blob
        );
        
        saveResults.push({
          originalUrl: originalUrl,
          fileName: result.value.fileName,
          success: true
        });
      } catch (saveError) {
        console.error(`Failed to save image ${i + 1}:`, saveError);
        saveResults.push({
          originalUrl: originalUrl,
          fileName: null,
          success: false,
          error: getErrorMessage(saveError)
        });
      }
    } else {
      // Download failed - skip this image and continue
      console.warn(`Skipping failed image ${i + 1}:`, result.reason);
      saveResults.push({
        originalUrl: originalUrl,
        fileName: null,
        success: false,
        error: getErrorMessage(result.reason)
      });
    }
  }
  
  const successCount = saveResults.filter(r => r.success).length;
  const failedCount = images.length - successCount;
  
  console.log(`Image batch processing complete: ${successCount}/${images.length} successful`);
  
  if (failedCount > 0) {
    console.warn(`${failedCount} image(s) failed to download/save - keeping original URLs`);
  }
  
  return saveResults;
}

/**
 * Create a new Markdown file with the given content
 * Handles filename conflicts by adding timestamp or appending
 * 
 * @param {FileSystemDirectoryHandle} folderHandle - Target folder handle
 * @param {string} fileName - Desired file name (without .md extension)
 * @param {string} content - Markdown content to write
 * @param {boolean} addTimestamp - Whether to always add timestamp to filename
 * @param {boolean} appendOnConflict - Whether to append to existing file on conflict
 * @returns {Promise<{fileName: string, wasAppended: boolean}>} Result object with filename and append status
 */
async function createNewMarkdownFile(folderHandle, fileName, content, addTimestamp = false, appendOnConflict = false) {
  try {
    // Ensure filename ends with .md
    let finalFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    
    // Sanitize filename (remove invalid characters)
    finalFileName = sanitizeFileName(finalFileName);
    
    console.log(`Creating new file: ${finalFileName}, addTimestamp: ${addTimestamp}, appendOnConflict: ${appendOnConflict}`);
    
    // Add timestamp if configured
    if (addTimestamp) {
      const timestamp = Date.now();
      const nameWithoutExt = finalFileName.replace(/\.md$/, '');
      finalFileName = `${nameWithoutExt}-${timestamp}.md`;
      console.log(`Adding timestamp to filename: ${finalFileName}`);
    } else {
      // Check if file already exists only when timestamp is not forced
      let fileHandle;
      try {
        // Try to get existing file
        fileHandle = await folderHandle.getFileHandle(finalFileName, { create: false });
        
        // File exists - decide what to do based on appendOnConflict setting
        if (appendOnConflict) {
          // Append to existing file instead of creating new one
          console.log(`File exists and appendOnConflict is enabled, appending to: ${finalFileName}`);
          await appendToMarkdownFile(folderHandle, finalFileName, content);
          return { fileName: finalFileName, wasAppended: true };
        } else {
          // Add timestamp to avoid conflict
          const timestamp = Date.now();
          const nameWithoutExt = finalFileName.replace(/\.md$/, '');
          finalFileName = `${nameWithoutExt}-${timestamp}.md`;
          console.log(`File exists, using timestamped name: ${finalFileName}`);
        }
        
      } catch (error) {
        // File doesn't exist, which is what we want
        console.log('File does not exist, proceeding with original name');
      }
    }
    
    // Create the new file
    try {
      fileHandle = await folderHandle.getFileHandle(finalFileName, { create: true });
    } catch (createError) {
      console.error('Failed to create file handle:', createError);
      if (createError.name === 'NotAllowedError') {
        throw new Error('没有权限创建文件');
      } else if (createError.name === 'NotFoundError') {
        throw new Error('目标文件夹不存在');
      }
      throw new Error('无法创建文件: ' + createError.message);
    }
    
    // Create writable stream
    let writable;
    try {
      writable = await fileHandle.createWritable();
    } catch (writableError) {
      console.error('Failed to create writable stream:', writableError);
      if (writableError.name === 'NoModificationAllowedError') {
        throw new Error('文件被占用或只读');
      }
      throw new Error('无法写入文件: ' + writableError.message);
    }
    
    try {
      // Write content to file
      await writable.write(content);
      
      // Close the stream
      await writable.close();
      
      console.log(`File created successfully: ${finalFileName}`);
      
      return { fileName: finalFileName, wasAppended: false };
    } catch (writeError) {
      // Try to close the stream on error
      try {
        await writable.close();
      } catch (closeError) {
        console.error('Failed to close writable stream:', closeError);
      }
      
      console.error('Failed to write content:', writeError);
      if (writeError.name === 'QuotaExceededError') {
        throw new Error('磁盘空间不足');
      }
      throw new Error('写入文件失败: ' + writeError.message);
    }
    
  } catch (error) {
    console.error('Failed to create new file:', error);
    throw error;
  }
}

/**
 * Append content to an existing Markdown file
 * Adds separator and proper newlines
 * 
 * @param {FileSystemDirectoryHandle} folderHandle - Target folder handle
 * @param {string} fileName - Name of the existing file
 * @param {string} content - Content to append
 * @returns {Promise<void>}
 */
async function appendToMarkdownFile(folderHandle, fileName, content) {
  try {
    console.log(`Appending to existing file: ${fileName}`);
    
    // Get the existing file handle
    let fileHandle;
    try {
      fileHandle = await folderHandle.getFileHandle(fileName, { create: false });
    } catch (getError) {
      console.error('Failed to get file handle:', getError);
      if (getError.name === 'NotFoundError') {
        throw new Error('文件不存在: ' + fileName);
      } else if (getError.name === 'NotAllowedError') {
        throw new Error('没有权限访问文件');
      }
      throw new Error('无法访问文件: ' + getError.message);
    }
    
    // Read existing content
    let existingContent;
    try {
      const file = await fileHandle.getFile();
      existingContent = await file.text();
      console.log(`Existing file size: ${existingContent.length} characters`);
    } catch (readError) {
      console.error('Failed to read file:', readError);
      throw new Error('无法读取文件内容: ' + readError.message);
    }
    
    // Prepare content to append
    // Add separator and proper newlines
    let contentToAppend = '\n\n---\n\n' + content;
    
    // If existing file doesn't end with newline, add one before separator
    if (existingContent.length > 0 && !existingContent.endsWith('\n')) {
      contentToAppend = '\n' + contentToAppend;
    }
    
    // Combine existing and new content
    const finalContent = existingContent + contentToAppend;
    
    // Create writable stream
    let writable;
    try {
      writable = await fileHandle.createWritable();
    } catch (writableError) {
      console.error('Failed to create writable stream:', writableError);
      if (writableError.name === 'NoModificationAllowedError') {
        throw new Error('文件被占用或只读');
      }
      throw new Error('无法写入文件: ' + writableError.message);
    }
    
    try {
      // Write combined content
      await writable.write(finalContent);
      
      // Close the stream
      await writable.close();
      
      console.log(`Content appended successfully to: ${fileName}`);
    } catch (writeError) {
      // Try to close the stream on error
      try {
        await writable.close();
      } catch (closeError) {
        console.error('Failed to close writable stream:', closeError);
      }
      
      console.error('Failed to write content:', writeError);
      if (writeError.name === 'QuotaExceededError') {
        throw new Error('磁盘空间不足');
      }
      throw new Error('写入文件失败: ' + writeError.message);
    }
    
  } catch (error) {
    console.error('Failed to append to file:', error);
    throw error;
  }
}

/**
 * Sanitize filename by removing invalid characters
 * 
 * @param {string} fileName - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFileName(fileName) {
  // Remove or replace invalid characters for file systems
  // Invalid characters: < > : " / \ | ? *
  let sanitized = fileName.replace(/[<>:"/\\|?*]/g, '-');
  
  // Remove leading/trailing spaces and dots
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');
  
  // Ensure filename is not empty
  if (!sanitized || sanitized === '.md') {
    sanitized = `untitled-${Date.now()}.md`;
  }
  
  // Limit filename length (max 255 characters for most file systems)
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const extension = '.md';
    const nameWithoutExt = sanitized.slice(0, maxLength - extension.length);
    sanitized = nameWithoutExt + extension;
  }
  
  return sanitized;
}

/**
 * Handle file save request
 */
async function handleFileSave(fileSelection) {
  try {
    if (!pickerContext) {
      throw new Error('没有可用的上下文数据');
    }
    
    const folderHandle = await getFolderHandle();
    
    if (!folderHandle) {
      throw new Error('未配置目标文件夹');
    }
    
    // Verify permission
    let permission;
    try {
      permission = await folderHandle.queryPermission({ mode: 'readwrite' });
    } catch (permError) {
      console.error('Permission query error:', permError);
      throw new Error('无法检查文件夹权限，请重新选择文件夹');
    }
    
    if (permission !== 'granted') {
      try {
        const requestPermission = await folderHandle.requestPermission({ mode: 'readwrite' });
        if (requestPermission !== 'granted') {
          throw new Error('文件夹访问权限被拒绝');
        }
      } catch (reqError) {
        console.error('Permission request error:', reqError);
        throw new Error('无法获取文件夹访问权限');
      }
    }
    
    // Format markdown content (with placeholder image URLs)
    let markdownContent = formatMarkdownContent(
      pickerContext.pageUrl,
      pickerContext.pageTitle,
      pickerContext.config.prefixText,
      pickerContext.selectedContent,
      pickerContext.config.suffixText
    );
    
    console.log('Initial markdown content:', markdownContent);
    
    // Download and save images if present (based on configuration)
    let imageResults = [];
    const shouldDownloadImages = pickerContext.config.imageMode === 'download';
    
    if (pickerContext.selectedContent.images && pickerContext.selectedContent.images.length > 0) {
      console.log(`Processing ${pickerContext.selectedContent.images.length} images, mode: ${pickerContext.config.imageMode}`);
      
      if (shouldDownloadImages) {
        // Download mode: download images and replace with local references
        try {
          imageResults = await downloadAndSaveImages(
            pickerContext.selectedContent.images,
            folderHandle
          );
          
          // Replace image URLs with local references
          markdownContent = replaceImageReferences(markdownContent, imageResults);
          
          const successCount = imageResults.filter(r => r.success).length;
          const failedCount = imageResults.length - successCount;
          
          console.log(`Images processed: ${successCount}/${imageResults.length} successful`);
          
          if (failedCount > 0) {
            console.warn(`${failedCount} image(s) failed - original URLs kept in markdown`);
          }
          
        } catch (imageError) {
          console.error('Error processing images:', imageError);
          // Continue with saving content even if images fail
          // The markdown will contain original URLs for failed images
        }
      } else {
        // URL mode: keep original URLs, no download needed
        console.log('Image mode is URL, keeping original image URLs');
      }
    }
    
    console.log('Final markdown content:', markdownContent);
    
    // Save to file based on selection type
    let finalFileName;
    let wasAppended = false;
    
    if (fileSelection.type === 'new') {
      // Create new file
      try {
        const result = await createNewMarkdownFile(
          folderHandle,
          fileSelection.fileName,
          markdownContent,
          pickerContext.config.addTimestamp,
          pickerContext.config.appendOnConflict
        );
        finalFileName = result.fileName;
        wasAppended = result.wasAppended;
        
        if (wasAppended) {
          console.log(`File existed, content appended to: ${finalFileName}`);
        } else {
          console.log(`New file created: ${finalFileName}`);
        }
      } catch (createError) {
        console.error('Failed to create new file:', createError);
        throw new Error('创建文件失败: ' + getErrorMessage(createError));
      }
      
    } else if (fileSelection.type === 'existing') {
      // Append to existing file
      try {
        await appendToMarkdownFile(
          folderHandle,
          fileSelection.fileName,
          markdownContent
        );
        finalFileName = fileSelection.fileName;
        wasAppended = true;
        console.log(`Content appended to: ${finalFileName}`);
      } catch (appendError) {
        console.error('Failed to append to file:', appendError);
        throw new Error('追加内容失败: ' + getErrorMessage(appendError));
      }
      
    } else {
      throw new Error(`无效的文件选择类型: ${fileSelection.type}`);
    }
    
    // Show success notification
    let message = wasAppended 
      ? `已追加到: ${finalFileName}` 
      : `已保存到: ${finalFileName}`;
    
    // Add image processing info based on mode
    if (pickerContext.selectedContent.images && pickerContext.selectedContent.images.length > 0) {
      const totalImages = pickerContext.selectedContent.images.length;
      
      if (shouldDownloadImages) {
        // Download mode: show download statistics
        const successfulImages = imageResults.filter(r => r.success).length;
        const failedImages = totalImages - successfulImages;
        
        if (failedImages === 0) {
          message += `\n✓ ${totalImages}张图片全部保存成功`;
        } else if (successfulImages > 0) {
          message += `\n⚠ 图片: ${successfulImages}/${totalImages}成功，${failedImages}张失败`;
        } else {
          message += `\n✗ ${totalImages}张图片全部失败（保留原始URL）`;
        }
      } else {
        // URL mode: just show count
        message += `\n📎 ${totalImages}张图片使用URL链接`;
      }
    }
    
    showSuccessNotification('保存成功', message);
    
    console.log('File save completed successfully');
    
    // Refresh context menu immediately after file save
    const config = await getConfig();
    if (config.quickSaveMode) {
      console.log('Refreshing context menu after file save...');
      // Use setTimeout to avoid blocking
      setTimeout(async () => {
        await createContextMenu();
      }, 100);
    }
    
    // Clear context after use
    pickerContext = null;
    
  } catch (error) {
    console.error('Failed to handle file save:', error);
    showErrorNotification('保存失败', getErrorMessage(error));
    throw error;
  }
}

/**
 * Get user-friendly error message
 * 
 * @param {Error} error - Error object
 * @returns {string} User-friendly error message
 */
function getErrorMessage(error) {
  if (!error) return '未知错误';
  
  // If error already has a Chinese message, use it
  if (error.message && /[\u4e00-\u9fa5]/.test(error.message)) {
    return error.message;
  }
  
  // Map common error types to user-friendly messages
  const errorMap = {
    'NotAllowedError': '操作被拒绝，请检查权限设置',
    'NotFoundError': '文件或文件夹不存在',
    'QuotaExceededError': '磁盘空间不足',
    'NoModificationAllowedError': '文件被占用或只读',
    'TypeMismatchError': '文件类型不匹配',
    'AbortError': '操作被取消',
    'NetworkError': '网络连接失败',
    'TimeoutError': '操作超时'
  };
  
  if (error.name && errorMap[error.name]) {
    return errorMap[error.name];
  }
  
  // Return original message if no mapping found
  return error.message || '操作失败';
}

/**
 * Show success notification
 * 
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showSuccessNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: 1
  });
}

/**
 * Show error notification
 * 
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showErrorNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '❌ ' + title,
    message: message,
    priority: 2
  });
}

/**
 * Show warning notification
 * 
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
function showWarningNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '⚠ ' + title,
    message: message,
    priority: 1
  });
}

// Listen for configuration changes to update context menu
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.quickSaveMode) {
    console.log('Quick save mode changed, recreating context menu');
    createContextMenu();
  }
});



console.log('Obsidian Quick Clip background service worker initialized');
