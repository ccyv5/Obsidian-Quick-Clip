# Obsidian Web Clipper

Chrome 浏览器扩展，用于保存网页内容到 Obsidian 兼容的 Markdown 文件。

## 核心功能

### 快速保存模式（默认）
- 右键菜单直接显示文件列表
- 一键快速保存到新文件或现有文件
- 实时刷新文件列表

### 内容处理
- 支持文本和图片混合内容
- 保持图片在原始位置
- 可选图片处理方式：
  - URL 链接模式（默认）：不下载图片，使用原始 URL
  - 本地下载模式：下载到 images 文件夹，使用 Obsidian 格式

### 智能文件管理
- 同名文件自动追加（默认）
- 可选时间戳模式避免冲突
- 自动清理文件名特殊字符
- 支持中文文件名和内容

### 自定义配置
- 自定义前置/后置文本
- 灵活的图片处理选项
- 传统弹窗模式可选

## 项目结构

```
obsidian-web-clipper/
├── manifest.json           # 扩展配置 (Manifest V3)
├── options.html           # 配置页面
├── file-picker.html       # 文件选择器（传统模式）
├── icons/                 # 扩展图标
│   ├── icon.svg          # SVG 源文件
│   ├── icon16.png        # 16x16 工具栏图标
│   ├── icon48.png        # 48x48 管理页图标
│   ├── icon128.png       # 128x128 商店图标
│   └── README.md         # 图标生成指南
├── scripts/              # JavaScript 文件
│   ├── background.js     # 后台服务（核心逻辑）
│   ├── content.js        # 内容脚本（页面交互）
│   ├── options.js        # 配置页面逻辑
│   └── file-picker.js    # 文件选择器逻辑
├── styles/               # CSS 文件
│   ├── options.css       # 配置页面样式
│   └── file-picker.css   # 文件选择器样式
├── README.md             # 项目说明
├── 测试清单.md           # 完整测试清单
└── 项目总结.md           # 项目总结
```

## 默认配置

首次使用时的推荐配置：
- **快速保存模式**：开启（右键菜单显示文件列表）
- **图片处理**：保留URL链接（不下载，节省空间）
- **文件名时间戳**：关闭
- **同名文件处理**：自动追加到现有文件

所有设置可在扩展选项中随时修改。

## Installation

### For Development

1. Clone or download this repository
2. Generate icon files from `icons/icon.svg` (see `icons/README.md`)
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top-right corner)
5. Click "Load unpacked"
6. Select the project directory

### Configuration

1. Click the extension icon or right-click and select "Options"
2. Select your target Obsidian vault folder
3. (Optional) Configure custom prefix and suffix text
4. Save your configuration

## 使用方法

### 快速保存模式（推荐）
1. 在网页中选中文本或图片
2. 右键点击 → "保存到Obsidian"
3. 选择：
   - 📝 新建文件...（使用页面标题作为文件名）
   - 或点击现有文件名追加内容
4. 内容自动保存为 Obsidian 兼容的 Markdown 格式

### 传统弹窗模式
1. 在扩展选项中关闭"快速保存模式"
2. 右键保存时会打开弹窗
3. 在弹窗中输入文件名或选择现有文件

## Requirements

- Chrome 88+ (for File System Access API support)
- Local Obsidian vault folder

## 常见问题

### 右键菜单不显示
- 刷新网页重新加载 content script
- 确保已选中文本
- 浏览器内部页面（chrome://、about: 等）不支持

### 文件列表不更新
- 右键点击时会自动刷新
- 查看 Service Worker 日志确认刷新
- 保存文件后也会自动刷新

### 图片不显示
- URL 模式：需要网络连接
- 下载模式：检查 images 文件夹和文件权限
- 在 Obsidian 中检查图片路径设置

## Technical Details

- **Manifest Version**: V3
- **Permissions**: contextMenus, storage, activeTab
- **APIs Used**: File System Access API, Chrome Storage API

## 开发状态

✅ **功能完成，可以使用**

所有核心功能已实现并测试通过。详见 `测试清单.md`。

## License

MIT
