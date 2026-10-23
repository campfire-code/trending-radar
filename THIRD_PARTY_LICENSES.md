# 第三方开源组件

本工具使用了以下开源组件，许可证原文见各项目仓库。

| 组件 | 用途 | 许可证 |
|---|---|---|
| [Tauri](https://github.com/tauri-apps/tauri) 及官方插件 | 桌面应用框架 | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react) | 界面 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) | 图标 | ISC |
| [Vite](https://github.com/vitejs/vite) | 构建 | MIT |
| [exceljs](https://github.com/exceljs/exceljs) | 导出 Excel | MIT |
| [jsdom](https://github.com/jsdom/jsdom) | 测试中模拟浏览器（仅开发时使用，不打进安装包） | MIT |

## 移植的代码

| 来源 | 内容 | 许可证 |
|---|---|---|
| [newsnext/newsnow](https://github.com/newsnext/newsnow) `server/sources` | 微博、知乎、百度、抖音、B 站、今日头条、澎湃、贴吧、36 氪、IT 之家、少数派、稀土掘金、华尔街见闻、财联社的请求地址、请求头与解析规则（`src/tool/core.ts`） | MIT，Copyright (c) 2024 ourongxing |

说明：财联社接口的签名规则（参数排序后先 SHA-1 再 MD5）取自 newsnow 的 `server/sources/cls/utils.ts`（MIT），该文件注释写明参考了 RSSHub（AGPL-3.0）。本工具只沿用这一接口约定，没有复制 RSSHub 的代码；MD5 为本工具自行实现。

### newsnow 许可证原文

```text
MIT License

Copyright (c) 2024 ourongxing

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
