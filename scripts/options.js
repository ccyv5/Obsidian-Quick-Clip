// Options page script for Obsidian Web Clipper

// DOM elements
const selectFolderBtn = document.getElementById('selectFolder');
const folderPathDisplay = document.getElementById('folderPath');
const prefixTextArea = document.getElementById('prefixText');
const suffixTextArea = document.getElementById('suffixText');
const addTimestampCheckbox = document.getElementById('addTimestamp');
const appendOnConflictCheckbox = document.getElementById('appendOnConflict');
const imageModeDownload = document.getElementById('imageModeDownload');
const imageModeUrl = document.getElementById('imageModeUrl');
const quickSaveModeCheckbox = document.getElementById('quickSaveMode');
const saveConfigBtn = document.getElementById('saveConfig');
const statusDiv = document.getElementById('status');

// Store the current folder handle
let currentFolderHandle = null;

/**
 * Load saved configuration from Chrome Storage
 */
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['prefixText', 'suffixText', 'folderName', 'addTimestamp', 'appendOnConflict', 'imageMode', 'quickSaveMode']);
    
    // Load text configurations
    if (result.prefixText) {
      prefixTextArea.value = result.prefixText;
    }
    
    if (result.suffixText) {
      suffixTextArea.value = result.suffixText;
    }
    
    // Load timestamp setting (default to false)
    addTimestampCheckbox.checked = result.addTimestamp === true;
    
    // Load append on conflict setting (default to true)
    appendOnConflictCheckbox.checked = result.appendOnConflict !== false;
    
    // Load image mode setting (default to 'url')
    const imageMode = result.imageMode || 'url';
    if (imageMode === 'download') {
      imageModeDownload.checked = true;
    } else {
      imageModeUrl.checked = true;
    }
    
    // Load quick save mode setting (default to true)
    quickSaveModeCheckbox.checked = result.quickSaveMode !== false;
    
    // Display folder name if available
    if (result.folderName) {
      folderPathDisplay.textContent = `已选择: ${result.folderName}`;
      folderPathDisplay.style.color = '#28a745';
    }
  } catch (error) {
    console.error('加载配置失败:', error);
    showStatus('加载配置失败', 'error');
  }
}

/**
 * Handle folder selection using File System Access API
 */
async function selectFolder() {
  try {
    // Check if File System Access API is supported
    if (!window.showDirectoryPicker) {
      showStatus('您的浏览器不支持文件系统访问功能，请更新Chrome浏览器', 'error');
      return;
    }
    
    // Request directory access
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });
    
    currentFolderHandle = dirHandle;
    
    // Display the selected folder name
    folderPathDisplay.textContent = `已选择: ${dirHandle.name}`;
    folderPathDisplay.style.color = '#28a745';
    
    // Save the folder handle to IndexedDB for persistence
    try {
      await saveFolderHandle(dirHandle);
      showStatus('文件夹选择成功', 'success');
    } catch (saveError) {
      console.error('保存文件夹句柄失败:', saveError);
      showStatus('文件夹已选择，但保存配置失败: ' + saveError.message, 'error');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      // User cancelled the picker
      console.log('用户取消了文件夹选择');
    } else if (error.name === 'SecurityError') {
      console.error('安全错误:', error);
      showStatus('安全限制：无法访问文件系统', 'error');
    } else if (error.name === 'NotAllowedError') {
      console.error('权限被拒绝:', error);
      showStatus('文件夹访问权限被拒绝', 'error');
    } else {
      console.error('选择文件夹失败:', error);
      showStatus('选择文件夹失败: ' + error.message, 'error');
    }
  }
}

/**
 * Save folder handle to IndexedDB
 * Note: FileSystemHandle cannot be stored in Chrome Storage directly,
 * so we use IndexedDB for persistence
 */
async function saveFolderHandle(dirHandle) {
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
      
      try {
        const transaction = db.transaction(['folderHandles'], 'readwrite');
        const store = transaction.objectStore('folderHandles');
        
        // Store the handle with a fixed key
        const putRequest = store.put({ id: 'targetFolder', handle: dirHandle, name: dirHandle.name });
        
        putRequest.onerror = () => {
          console.error('Failed to store folder handle:', putRequest.error);
          reject(new Error('保存文件夹句柄失败'));
        };
        
        transaction.oncomplete = () => {
          // Also save folder name to Chrome Storage for easy access
          chrome.storage.local.set({ folderName: dirHandle.name })
            .then(() => resolve())
            .catch((storageError) => {
              console.error('Failed to save folder name:', storageError);
              // Still resolve since the main handle was saved
              resolve();
            });
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
 * Load folder handle from IndexedDB
 */
async function loadFolderHandle() {
  return new Promise((resolve, reject) => {
    let request;
    
    try {
      request = indexedDB.open('ObsidianClipperDB', 1);
    } catch (error) {
      console.error('Failed to open database:', error);
      resolve(null); // Don't reject, just return null
      return;
    }
    
    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      resolve(null); // Don't reject, just return null
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
            currentFolderHandle = getRequest.result.handle;
            resolve(getRequest.result.handle);
          } else {
            resolve(null);
          }
        };
        
        getRequest.onerror = () => {
          console.error('Failed to retrieve folder handle:', getRequest.error);
          resolve(null); // Don't reject, just return null
        };
        
        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          resolve(null); // Don't reject, just return null
        };
      } catch (error) {
        console.error('Transaction creation error:', error);
        resolve(null); // Don't reject, just return null
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
        // Continue anyway
      }
    };
  });
}

/**
 * Save configuration to Chrome Storage
 */
async function saveConfig() {
  try {
    const imageMode = imageModeDownload.checked ? 'download' : 'url';
    
    const config = {
      prefixText: prefixTextArea.value,
      suffixText: suffixTextArea.value,
      addTimestamp: addTimestampCheckbox.checked,
      appendOnConflict: appendOnConflictCheckbox.checked,
      imageMode: imageMode,
      quickSaveMode: quickSaveModeCheckbox.checked
    };
    
    // Save to Chrome Storage
    await chrome.storage.local.set(config);
    
    // If folder is selected, ensure it's saved
    if (currentFolderHandle) {
      await saveFolderHandle(currentFolderHandle);
    }
    
    showStatus('配置保存成功', 'success');
  } catch (error) {
    console.error('保存配置失败:', error);
    showStatus('保存配置失败: ' + error.message, 'error');
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
  
  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

/**
 * Verify folder handle permission
 */
async function verifyFolderPermission(dirHandle) {
  try {
    const options = { mode: 'readwrite' };
    
    // Check if permission was already granted
    let permission;
    try {
      permission = await dirHandle.queryPermission(options);
    } catch (queryError) {
      console.error('Failed to query permission:', queryError);
      return false;
    }
    
    if (permission === 'granted') {
      return true;
    }
    
    // Request permission
    try {
      const requestPermission = await dirHandle.requestPermission(options);
      if (requestPermission === 'granted') {
        return true;
      }
    } catch (requestError) {
      console.error('Failed to request permission:', requestError);
      return false;
    }
    
    return false;
  } catch (error) {
    console.error('Error verifying folder permission:', error);
    return false;
  }
}

// Event listeners
selectFolderBtn.addEventListener('click', selectFolder);
saveConfigBtn.addEventListener('click', saveConfig);

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  
  // Try to load previously saved folder handle
  try {
    const savedHandle = await loadFolderHandle();
    if (savedHandle) {
      // Verify we still have permission
      const hasPermission = await verifyFolderPermission(savedHandle);
      if (hasPermission) {
        currentFolderHandle = savedHandle;
        folderPathDisplay.textContent = `已选择: ${savedHandle.name}`;
        folderPathDisplay.style.color = '#28a745';
      } else {
        folderPathDisplay.textContent = '需要重新授权文件夹访问权限';
        folderPathDisplay.style.color = '#dc3545';
      }
    }
  } catch (error) {
    console.error('加载文件夹句柄失败:', error);
  }
});
