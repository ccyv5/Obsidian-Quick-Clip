# 图标更新说明

## 使用 👺 emoji 作为图标

已创建 `icon-emoji.svg` 文件，包含 👺 emoji。

## 生成 PNG 图标的方法

### 方法 1：使用在线工具
1. 访问 https://www.aconvert.com/cn/image/svg-to-png/
2. 上传 `icon-emoji.svg`
3. 分别生成以下尺寸：
   - 16x16 → 保存为 `icon16.png`
   - 48x48 → 保存为 `icon48.png`
   - 128x128 → 保存为 `icon128.png`

### 方法 2：使用 Inkscape（免费软件）
1. 下载安装 Inkscape: https://inkscape.org/
2. 打开 `icon-emoji.svg`
3. 文件 → 导出 PNG 图像
4. 设置宽度/高度为 16/48/128
5. 导出为对应的文件名

### 方法 3：使用 ImageMagick（命令行）
```bash
# 安装 ImageMagick
# Windows: choco install imagemagick
# Mac: brew install imagemagick

# 生成图标
magick icon-emoji.svg -resize 16x16 icon16.png
magick icon-emoji.svg -resize 48x48 icon48.png
magick icon-emoji.svg -resize 128x128 icon128.png
```

### 方法 4：使用 Node.js (sharp)
```bash
npm install sharp
node generate-icons.js
```

## 快速方案：使用 Emoji 截图
1. 打开浏览器，访问 https://emojipedia.org/
2. 搜索 👺 (Goblin)
3. 截图或下载高清版本
4. 使用图片编辑工具调整为 16x16, 48x48, 128x128

## 注意事项
- 确保背景透明或白色
- PNG 格式
- 替换现有的 icon16.png, icon48.png, icon128.png
