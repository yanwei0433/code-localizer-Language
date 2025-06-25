# 国际化支持说明

## 概述

Code Localizer 扩展现在支持多语言界面，可以根据用户的 VSCode 语言设置自动显示相应的语言。

## 支持的语言

项目现在支持以下 **11种语言** 的完整界面本地化：

- **中文 (默认)**: `package.nls.json` - 简体中文
- **繁体中文**: `package.nls.zh-TW.json` - 繁体中文
- **英文**: `package.nls.en.json` - English
- **日文**: `package.nls.ja.json` - 日本語
- **韩文**: `package.nls.ko.json` - 한국어
- **俄文**: `package.nls.ru.json` - Русский
- **法文**: `package.nls.fr.json` - Français
- **德文**: `package.nls.de.json` - Deutsch
- **西班牙文**: `package.nls.es.json` - Español
- **葡萄牙文(巴西)**: `package.nls.pt-BR.json` - Português (Brasil)
- **意大利文**: `package.nls.it.json` - Italiano
- **土耳其文**: `package.nls.tr.json` - Türkçe

## 工作原理

1. **自动检测**: VSCode 会根据用户的语言设置自动选择相应的语言包文件
2. **回退机制**: 如果找不到对应语言的翻译，会回退到默认的中文翻译
3. **本地化键**: 所有菜单和配置项都使用本地化键，如 `%extractCurrentFile.title%`

## 语言包文件对应关系

| VSCode语言设置 | 语言包文件 | 语言名称 |
|---------------|-----------|----------|
| `zh-cn` | `package.nls.json` | 简体中文 |
| `zh-tw` | `package.nls.zh-TW.json` | 繁体中文 |
| `en` | `package.nls.en.json` | English |
| `ja` | `package.nls.ja.json` | 日本語 |
| `ko` | `package.nls.ko.json` | 한국어 |
| `ru` | `package.nls.ru.json` | Русский |
| `fr` | `package.nls.fr.json` | Français |
| `de` | `package.nls.de.json` | Deutsch |
| `es` | `package.nls.es.json` | Español |
| `pt-br` | `package.nls.pt-BR.json` | Português (Brasil) |
| `it` | `package.nls.it.json` | Italiano |
| `tr` | `package.nls.tr.json` | Türkçe |

## 添加新语言支持

要添加新的语言支持，请按以下步骤操作：

### 1. 创建语言包文件

创建 `package.nls.{语言代码}.json` 文件，例如：
- `package.nls.ar.json` (阿拉伯语)
- `package.nls.nl.json` (荷兰语)
- `package.nls.sv.json` (瑞典语)

### 2. 翻译所有键值

复制 `package.nls.json` 的内容，然后将所有中文值翻译为目标语言：

```json
{
  "extractCurrentFile.title": "翻译后的标题",
  "testCollector.title": "翻译后的标题",
  // ... 其他所有键值
}
```

### 3. 测试

重新加载扩展后，将 VSCode 语言设置为目标语言，检查菜单是否正确显示。

## 语言包文件结构

每个语言包文件包含以下类型的翻译：

### 命令标题
- `extractCurrentFile.title`: 提取文件中的词汇
- `translateSelected.title`: 翻译选中的标识符
- 等等...

### 菜单标签
- `codeLocalizer.contextMenu.label`: 右键菜单标题

### 配置描述
- `configuration.title`: 配置页面标题
- `targetLanguage.description`: 目标语言设置描述
- 等等...

## 示例：不同语言用户界面

### 法语用户界面
当法国用户使用法语版 VSCode 时，他们会看到：
- 右键菜单显示 "Localisation de code"
- 命令面板中的命令显示法语名称
- 设置页面的描述显示法语

### 日语用户界面
当日本用户使用日语版 VSCode 时，他们会看到：
- 右键菜单显示 "コードローカライゼーション"
- 命令面板中的命令显示日语名称
- 设置页面的描述显示日语

### 德语用户界面
当德国用户使用德语版 VSCode 时，他们会看到：
- 右键菜单显示 "Code-Lokalisierung"
- 命令面板中的命令显示德语名称
- 设置页面的描述显示德语

## 技术实现

- 使用 VSCode 的标准国际化机制
- 本地化键格式：`%key%`
- 语言包文件命名：`package.nls.{语言代码}.json`
- 默认语言包：`package.nls.json`

## 注意事项

1. 所有新增的命令和配置项都需要在语言包中添加对应的翻译
2. 翻译时保持专业术语的一致性
3. 考虑不同语言的文化差异和表达习惯
4. 定期更新翻译以保持与功能同步
5. 确保翻译的准确性和专业性，特别是技术术语

## 贡献翻译

欢迎社区贡献新的语言翻译或改进现有翻译。请确保：
- 翻译准确且符合目标语言的习惯表达
- 技术术语保持一致性
- 遵循各语言的语法和标点符号规范 