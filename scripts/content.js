// Content Script for Obsidian Quick Clip
console.log('Obsidian Quick Clip content script loaded');

/**
 * 将相对URL转换为绝对URL
 * @param {string} url - 可能是相对或绝对的URL
 * @returns {string} 绝对URL
 */
function toAbsoluteURL(url) {
  if (!url) return '';
  
  // 如果已经是绝对URL，直接返回
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  
  // 处理协议相对URL (//example.com/image.png)
  if (url.startsWith('//')) {
    return window.location.protocol + url;
  }
  
  // 处理相对URL
  try {
    return new URL(url, window.location.href).href;
  } catch (e) {
    console.warn('Failed to convert URL:', url, e);
    return url;
  }
}

/**
 * 从选中范围中提取图片信息
 * @param {Selection} selection - 浏览器选择对象
 * @returns {Array<{src: string, alt: string, position: number}>} 图片信息数组
 */
function extractImagesFromSelection(selection) {
  const images = [];
  
  if (!selection || selection.rangeCount === 0) {
    return images;
  }
  
  try {
    const range = selection.getRangeAt(0);
    const container = range.cloneContents();
    
    // 查找容器中的所有img元素
    const imgElements = container.querySelectorAll('img');
    imgElements.forEach((img, index) => {
      try {
        const src = img.getAttribute('src');
        if (src && src.trim()) {
          const absoluteSrc = toAbsoluteURL(src);
          // Only add valid URLs
          if (absoluteSrc && (absoluteSrc.startsWith('http') || absoluteSrc.startsWith('data:'))) {
            images.push({
              src: absoluteSrc,
              alt: img.getAttribute('alt') || '',
              position: index
            });
          }
        }
      } catch (imgError) {
        console.warn('Failed to process image:', imgError);
      }
    });
    
    // 检查选中范围内的元素是否有背景图片
    if (range.commonAncestorContainer) {
      try {
        const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE 
          ? range.commonAncestorContainer 
          : range.commonAncestorContainer.parentElement;
        
        if (ancestor) {
          const elementsWithBg = ancestor.querySelectorAll('*');
          elementsWithBg.forEach((element) => {
            try {
              // 检查元素是否在选中范围内
              if (range.intersectsNode(element)) {
                const style = window.getComputedStyle(element);
                const bgImage = style.backgroundImage;
                
                if (bgImage && bgImage !== 'none') {
                  // 提取URL from url("...")
                  const urlMatch = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
                  if (urlMatch && urlMatch[1]) {
                    const absoluteSrc = toAbsoluteURL(urlMatch[1]);
                    // Only add valid URLs
                    if (absoluteSrc && (absoluteSrc.startsWith('http') || absoluteSrc.startsWith('data:'))) {
                      images.push({
                        src: absoluteSrc,
                        alt: element.getAttribute('aria-label') || '',
                        position: images.length
                      });
                    }
                  }
                }
              }
            } catch (bgError) {
              console.warn('Failed to process background image:', bgError);
            }
          });
        }
      } catch (ancestorError) {
        console.warn('Failed to process ancestor elements:', ancestorError);
      }
    }
  } catch (e) {
    console.error('Error extracting images:', e);
  }
  
  // Remove duplicate images (same src)
  const uniqueImages = [];
  const seenSrcs = new Set();
  images.forEach(img => {
    if (!seenSrcs.has(img.src)) {
      seenSrcs.add(img.src);
      uniqueImages.push(img);
    }
  });
  
  return uniqueImages;
}

/**
 * 获取用户选中的内容
 * @returns {{text: string, html: string, images: Array<{src: string, alt: string, position: number}>}}
 */
function getSelectedContent() {
  const selection = window.getSelection();
  
  if (!selection || selection.rangeCount === 0) {
    return {
      text: '',
      html: '',
      images: []
    };
  }
  
  // 获取纯文本内容
  const text = selection.toString().trim();
  
  // 获取HTML内容
  let html = '';
  try {
    const range = selection.getRangeAt(0);
    const container = range.cloneContents();
    const div = document.createElement('div');
    div.appendChild(container);
    html = div.innerHTML;
  } catch (e) {
    console.error('Error getting HTML content:', e);
    html = text;
  }
  
  // 提取图片
  const images = extractImagesFromSelection(selection);
  
  return {
    text,
    html,
    images
  };
}

/**
 * 监听来自Background的消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    try {
      const selection = getSelectedContent();
      
      // Validate that we have some content
      if (!selection.text && (!selection.images || selection.images.length === 0)) {
        console.warn('No content selected');
      }
      
      sendResponse(selection);
    } catch (error) {
      console.error('Error getting selection:', error);
      // Send empty response on error
      sendResponse({ 
        text: '', 
        html: '', 
        images: [],
        error: error.message 
      });
    }
    return true; // 保持消息通道开放以支持异步响应
  }
  
  // Return false for unhandled messages
  return false;
});

// Listen for contextmenu event to refresh file list before menu shows
document.addEventListener('contextmenu', (event) => {
  // Check if user has selected text
  const selection = window.getSelection();
  
  if (selection && selection.toString().trim().length > 0) {
    console.log('Right-click on selection detected, requesting menu refresh...');
    
    // Notify background to refresh menu
    // Use sendMessage without waiting for response to avoid blocking
    chrome.runtime.sendMessage({ 
      action: 'refreshMenu'
    }).catch(error => {
      console.debug('Failed to request menu refresh:', error);
    });
  }
}, true); // Use capture phase to catch event early


