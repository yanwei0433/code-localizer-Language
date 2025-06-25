// 母语化编程语法高亮系统
// 为翻译后的代码文本提供语法高亮功能

/**
 * 代码元素的语法角色枚举
 */
export enum SyntaxRole {
    // 基础语法元素
    KEYWORD,           // 关键字 (if, else, return, while...)
    CONTROL,           // 控制流 (for, while, if, switch...)
    DECLARATION,       // 声明关键字 (const, let, var, function...)
    TYPE,              // 类型 (string, number, boolean...)
    OPERATOR,          // 运算符 (+, -, *, /, =, ==, ===...)
    FUNCTION,          // 函数名
    METHOD,            // 方法名
    PROPERTY,          // 属性名
    VARIABLE,          // 变量名
    PARAMETER,         // 参数名
    
    // 字面量
    STRING,            // 字符串字面量
    NUMBER,            // 数字字面量
    BOOLEAN,           // 布尔字面量
    NULL_UNDEFINED,    // null 或 undefined
    REGEX,             // 正则表达式
    
    // 特殊元素
    COMMENT,           // 注释
    DECORATOR,         // 装饰器
    CLASS,             // 类名
    NAMESPACE,         // 命名空间
    INTERFACE,         // 接口
    
    // 标点符号
    PUNCTUATION,       // 标点 ({}, [], (), ., ;, ,...)
    
    // 默认
    DEFAULT            // 默认样式
}

/**
 * 词汇的语法角色映射
 * 按字典分类存储常见编程词汇
 */
interface SyntaxMap {
    // 按语法角色组织的词汇表
    [role: number]: string[];
}

/**
 * 各种编程语言的语法映射
 */
interface LanguageSyntaxMaps {
    [language: string]: SyntaxMap;
}

/**
 * 全局语法映射，适用于所有语言
 */
const COMMON_SYNTAX_MAP: SyntaxMap = {
    // 关键字
    [SyntaxRole.KEYWORD]: ['if', 'else', 'return', 'break', 'continue', 'switch', 'case', 'default', 'throw', 'try', 'catch', 'finally', 'yield', 'await', 'async', 'new', 'delete', 'typeof', 'instanceof', 'void', 'in'],
    
    // 控制流
    [SyntaxRole.CONTROL]: ['for', 'while', 'do', 'if', 'else', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw'],
    
    // 声明关键字
    [SyntaxRole.DECLARATION]: ['var', 'let', 'const', 'function', 'class', 'interface', 'enum', 'export', 'import', 'extends', 'implements', 'static', 'get', 'set', 'public', 'private', 'protected'],
    
    // 类型
    [SyntaxRole.TYPE]: ['string', 'number', 'boolean', 'void', 'null', 'undefined', 'any', 'object', 'array', 'symbol', 'never', 'unknown', 'bigint'],
    
    // 运算符
    [SyntaxRole.OPERATOR]: ['+', '-', '*', '/', '%', '=', '==', '===', '!=', '!==', '>', '<', '>=', '<=', '&&', '||', '!', '&', '|', '^', '~', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '++', '--', '...'],
    
    // 布尔字面量
    [SyntaxRole.BOOLEAN]: ['true', 'false'],
    
    // null/undefined
    [SyntaxRole.NULL_UNDEFINED]: ['null', 'undefined', 'NaN'],
};

/**
 * JavaScript/TypeScript特定语法
 */
const JS_TS_SYNTAX_MAP: SyntaxMap = {
    ...COMMON_SYNTAX_MAP,
    // TypeScript特定关键字
    [SyntaxRole.KEYWORD]: [
        ...COMMON_SYNTAX_MAP[SyntaxRole.KEYWORD], 
        'as', 'is', 'keyof', 'readonly', 'declare', 'namespace', 'module'
    ],
    // JavaScript/TypeScript常见内置对象和方法
    [SyntaxRole.FUNCTION]: [
        'console', 'log', 'error', 'warn', 'info', 'debug', 'Table',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI'
    ]
};

/**
 * Python特定语法
 */
const PYTHON_SYNTAX_MAP: SyntaxMap = {
    ...COMMON_SYNTAX_MAP,
    // Python特定关键字
    [SyntaxRole.KEYWORD]: [
        'if', 'elif', 'else', 'while', 'for', 'in', 'try', 'except', 'finally',
        'pass', 'break', 'continue', 'return', 'yield', 'import', 'from', 'as',
        'class', 'def', 'lambda', 'with', 'assert', 'raise', 'global', 'nonlocal',
        'True', 'False', 'None', 'and', 'or', 'not', 'is', 'del'
    ],
    // Python装饰器
    [SyntaxRole.DECORATOR]: ['@classmethod', '@staticmethod', '@property', '@abstractmethod'],
    // Python常见内置函数
    [SyntaxRole.FUNCTION]: [
        'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'tuple', 'set',
        'sorted', 'open', 'map', 'filter', 'zip', 'enumerate', 'any', 'all', 'sum'
    ]
};

/**
 * C/C++特定语法
 */
const C_CPP_SYNTAX_MAP: SyntaxMap = {
    ...COMMON_SYNTAX_MAP,
    // C/C++特定关键字
    [SyntaxRole.KEYWORD]: [
        ...COMMON_SYNTAX_MAP[SyntaxRole.KEYWORD],
        'auto', 'register', 'static', 'extern', 'typedef',
        'sizeof', 'volatile', 'inline', 'const', 'restrict',
        'struct', 'union', 'enum', 'template', 'typename',
        'virtual', 'explicit', 'friend', 'constexpr', 'decltype',
        'noexcept', 'nullptr', 'override', 'final'
    ],
    // C/C++常见函数和宏
    [SyntaxRole.FUNCTION]: [
        'printf', 'scanf', 'malloc', 'free', 'memcpy', 'memset',
        'strcpy', 'strcmp', 'strcat', 'strlen', 'fopen', 'fclose',
        'fread', 'fwrite', 'fprintf', 'fscanf', 'cout', 'cin',
        'endl', 'new', 'delete'
    ],
    // C/C++类型
    [SyntaxRole.TYPE]: [
        ...COMMON_SYNTAX_MAP[SyntaxRole.TYPE],
        'int', 'char', 'float', 'double', 'short', 'long',
        'unsigned', 'signed', 'void', 'bool', 'wchar_t',
        'size_t', 'ptrdiff_t', 'FILE', 'va_list', 'jmp_buf',
        'vector', 'string', 'map', 'set', 'list', 'deque', 'queue',
        'stack', 'array', 'bitset', 'pair', 'tuple'
    ]
};

/**
 * Java特定语法
 */
const JAVA_SYNTAX_MAP: SyntaxMap = {
    ...COMMON_SYNTAX_MAP,
    // Java特定关键字
    [SyntaxRole.KEYWORD]: [
        ...COMMON_SYNTAX_MAP[SyntaxRole.KEYWORD],
        'abstract', 'assert', 'native', 'strictfp', 'synchronized',
        'throws', 'transient', 'volatile', 'instanceof', 'super',
        'extends', 'implements', 'interface', 'package'
    ],
    // Java常见类和方法
    [SyntaxRole.FUNCTION]: [
        'System', 'out', 'println', 'print', 'printf',
        'Scanner', 'nextInt', 'nextLine', 'nextDouble',
        'String', 'Integer', 'Boolean', 'Character', 'Double',
        'Math', 'Random', 'ArrayList', 'HashMap', 'Collections',
        'Arrays', 'List', 'Map', 'Set', 'StringBuilder'
    ]
};

/**
 * Go特定语法
 */
const GO_SYNTAX_MAP: SyntaxMap = {
    ...COMMON_SYNTAX_MAP,
    // Go特定关键字
    [SyntaxRole.KEYWORD]: [
        'func', 'go', 'chan', 'defer', 'fallthrough', 'go', 'map',
        'select', 'package', 'import', 'type', 'struct', 'interface',
        'range', 'if', 'else', 'switch', 'case', 'default', 'for',
        'break', 'continue', 'return', 'var', 'const'
    ],
    // Go常见函数和方法
    [SyntaxRole.FUNCTION]: [
        'fmt', 'Println', 'Printf', 'Sprintf', 'Print',
        'make', 'new', 'len', 'cap', 'append', 'copy',
        'delete', 'close', 'panic', 'recover'
    ]
};

/**
 * 所有语言的语法映射集合
 */
const LANGUAGE_SYNTAX_MAPS: LanguageSyntaxMaps = {
    'javascript': JS_TS_SYNTAX_MAP,
    'typescript': JS_TS_SYNTAX_MAP,
    'javascriptreact': JS_TS_SYNTAX_MAP,
    'typescriptreact': JS_TS_SYNTAX_MAP,
    'python': PYTHON_SYNTAX_MAP,
    'c': C_CPP_SYNTAX_MAP,
    'cpp': C_CPP_SYNTAX_MAP,
    'csharp': C_CPP_SYNTAX_MAP, // 基本语法与C/C++相似
    'java': JAVA_SYNTAX_MAP,
    'go': GO_SYNTAX_MAP,
    // 可以添加更多语言的支持
};

/**
 * 语法角色对应的颜色
 * 使用VSCode的内置主题变量，支持明暗主题
 */
const SYNTAX_COLORS: Record<number, string> = {
    [SyntaxRole.KEYWORD]: 'var(--vscode-keyword-foreground, #569cd6)',
    [SyntaxRole.CONTROL]: 'var(--vscode-keyword-control-foreground, #c586c0)',
    [SyntaxRole.DECLARATION]: 'var(--vscode-keyword-foreground, #569cd6)',
    [SyntaxRole.TYPE]: 'var(--vscode-type-foreground, #4ec9b0)',
    [SyntaxRole.OPERATOR]: 'var(--vscode-operator-foreground, #d4d4d4)',
    [SyntaxRole.FUNCTION]: 'var(--vscode-function-foreground, #dcdcaa)',
    [SyntaxRole.METHOD]: 'var(--vscode-method-foreground, #dcdcaa)',
    [SyntaxRole.PROPERTY]: 'var(--vscode-property-foreground, #9cdcfe)',
    [SyntaxRole.VARIABLE]: 'var(--vscode-variable-foreground, #9cdcfe)',
    [SyntaxRole.PARAMETER]: 'var(--vscode-parameter-foreground, #9cdcfe)',
    [SyntaxRole.STRING]: 'var(--vscode-string-foreground, #ce9178)',
    [SyntaxRole.NUMBER]: 'var(--vscode-number-foreground, #b5cea8)',
    [SyntaxRole.BOOLEAN]: 'var(--vscode-boolean-foreground, #569cd6)',
    [SyntaxRole.NULL_UNDEFINED]: 'var(--vscode-keyword-foreground, #569cd6)',
    [SyntaxRole.REGEX]: 'var(--vscode-regex-foreground, #d16969)',
    [SyntaxRole.COMMENT]: 'var(--vscode-comment-foreground, #6a9955)',
    [SyntaxRole.DECORATOR]: 'var(--vscode-decorator-foreground, #569cd6)',
    [SyntaxRole.CLASS]: 'var(--vscode-class-foreground, #4ec9b0)',
    [SyntaxRole.NAMESPACE]: 'var(--vscode-namespace-foreground, #4ec9b0)',
    [SyntaxRole.INTERFACE]: 'var(--vscode-interface-foreground, #4ec9b0)',
    [SyntaxRole.PUNCTUATION]: 'var(--vscode-punctuation-foreground, #d4d4d4)',
    [SyntaxRole.DEFAULT]: 'var(--vscode-editor-foreground, #d4d4d4)'
};

/**
 * 回退颜色，当特定语法角色没有定义颜色时使用
 */
const FALLBACK_COLOR = 'var(--vscode-editor-foreground, #d4d4d4)';

/**
 * 分析代码上下文的简单结构
 */
export interface CodeContext {
    lineText: string;       // 当前行文本
    wordIndex: number;      // 单词在当前行的索引位置
    languageId: string;     // 当前文档语言
    precedingChar?: string; // 前一个字符
    followingChar?: string; // 后一个字符
    indentation: number;    // 缩进级别
}

/**
 * 获取适合特定单词的语法高亮颜色
 * @param word 要高亮的单词
 * @param context 代码上下文信息
 * @returns 适合该单词的颜色
 */
export function getHighlightColor(word: string, context: CodeContext): string {
    // 尝试获取语法角色
    const role = inferSyntaxRole(word, context);
    
    // 返回对应角色的颜色，如果没有定义则使用默认颜色
    return SYNTAX_COLORS[role] || FALLBACK_COLOR;
}

/**
 * 推断单词的语法角色
 * @param word 要分析的单词
 * @param context 代码上下文
 * @returns 推断的语法角色
 */
function inferSyntaxRole(word: string, context: CodeContext): SyntaxRole {
    const lowerWord = word.toLowerCase();
    const language = context.languageId;
    
    // 获取当前语言的语法映射，如果不存在则使用通用映射
    const syntaxMap = LANGUAGE_SYNTAX_MAPS[language] || COMMON_SYNTAX_MAP;
    
    // 对各个语法角色进行检查
    for (const roleKey in syntaxMap) {
        const role = Number(roleKey) as SyntaxRole;
        const words = syntaxMap[role] || [];
        
        // 检查单词是否在该角色的列表中
        if (words.includes(lowerWord) || words.includes(word)) {
            return role;
        }
    }
    
    // 基于上下文进行更复杂的推断
    return inferRoleFromContext(word, context);
}

/**
 * 基于上下文推断语法角色
 * @param word 要分析的单词
 * @param context 代码上下文
 * @returns 推断的语法角色
 */
function inferRoleFromContext(word: string, context: CodeContext): SyntaxRole {
    const { lineText, wordIndex, precedingChar, followingChar, languageId } = context;
    
    // 检查是否是函数或方法
    if (followingChar === '(') {
        return SyntaxRole.FUNCTION;
    }
    
    // 检查是否是属性
    if (precedingChar === '.') {
        return SyntaxRole.PROPERTY;
    }
    
    // 检查是否是类名或接口
    // 通常类名以大写字母开头
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(word)) {
        // 检查前面是否有class, interface等关键字
        if (lineText.match(new RegExp(`\\b(class|interface|enum|struct|type)\\s+${word}\\b`))) {
            return SyntaxRole.CLASS;
        }
        
        // 检查是否在extends或implements后面
        if (lineText.match(new RegExp(`\\b(extends|implements)\\s+.*?\\b${word}\\b`))) {
            return SyntaxRole.CLASS;
        }
    }
    
    // 检查是否是变量声明
    const declarationPatterns: { [key: string]: RegExp } = {
        'javascript': /\b(const|let|var)\s+/,
        'typescript': /\b(const|let|var)\s+/,
        'python': /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/,
        'java': /\b([a-zA-Z_][a-zA-Z0-9_]*(<.*?>)?)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(=|;)/,
        'c': /\b([a-zA-Z_][a-zA-Z0-9_]*(<.*?>)?)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(=|;)/,
        'cpp': /\b([a-zA-Z_][a-zA-Z0-9_]*(<.*?>)?)\s+[a-zA-Z_][a-zA-Z0-9_]*\s*(=|;)/,
        'go': /\b(var|const)\s+/
    };
    
    const pattern = declarationPatterns[languageId] || declarationPatterns['javascript'];
    if (pattern.test(lineText)) {
        // 查找等号的位置
        const eqIndex = lineText.indexOf('=');
        const semiIndex = lineText.indexOf(';');
        const endIndex = eqIndex >= 0 ? eqIndex : (semiIndex >= 0 ? semiIndex : lineText.length);
        
        // 检查单词是否在声明段内
        const wordStart = lineText.indexOf(word);
        if (wordStart >= 0 && wordStart < endIndex) {
            const beforeWord = lineText.substring(0, wordStart).trim();
            // 如果单词前面有类型定义或声明关键字，那么它可能是一个变量
            if (beforeWord.match(/\b(const|let|var|int|float|double|string|boolean|char|long|short|void|auto|var)\b/)) {
                return SyntaxRole.VARIABLE;
            }
        }
    }
    
    // 检查是否是参数
    if (lineText.includes('(') && lineText.includes(')')) {
        const openParen = lineText.indexOf('(');
        const closeParen = lineText.indexOf(')', openParen);
        
        if (openParen >= 0 && closeParen >= 0) {
            const paramSection = lineText.substring(openParen + 1, closeParen);
            if (paramSection.includes(word)) {
                return SyntaxRole.PARAMETER;
            }
        }
    }

    // 检查字符串字面量
    if ((word.startsWith('"') && word.endsWith('"')) || 
        (word.startsWith("'") && word.endsWith("'")) ||
        (word.startsWith('`') && word.endsWith('`'))) {
        return SyntaxRole.STRING;
    }
    
    // 检查数字字面量
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(word)) {
        return SyntaxRole.NUMBER;
    }
    
    // 检查布尔字面量
    if (word === 'true' || word === 'false') {
        return SyntaxRole.BOOLEAN;
    }
    
    // 检查null或undefined
    if (word === 'null' || word === 'undefined' || word === 'None' || word === 'nil') {
        return SyntaxRole.NULL_UNDEFINED;
    }
    
    // 默认为变量
    return SyntaxRole.VARIABLE;
}

/**
 * 获取上下文信息
 * @param document 文档
 * @param position 位置
 * @returns 代码上下文
 */
export function getCodeContext(document: any, position: any): CodeContext {
    const lineText = document.lineAt(position.line).text;
    const wordRange = document.getWordRangeAtPosition(position);
    const wordIndex = wordRange ? wordRange.start.character : position.character;
    
    // 获取前后字符
    const precedingChar = wordIndex > 0 ? lineText[wordIndex - 1] : undefined;
    const followingChar = wordIndex < lineText.length ? lineText[wordIndex] : undefined;
    
    // 计算缩进级别
    const indentMatch = lineText.match(/^\s*/);
    const indentation = indentMatch ? indentMatch[0].length : 0;
    
    return {
        lineText,
        wordIndex,
        languageId: document.languageId,
        precedingChar,
        followingChar,
        indentation
    };
}

/**
 * 为特定编程语言添加自定义语法映射
 * @param language 语言ID
 * @param syntaxMap 语法映射
 */
export function addLanguageSyntaxMap(language: string, syntaxMap: SyntaxMap): void {
    LANGUAGE_SYNTAX_MAPS[language] = {
        ...COMMON_SYNTAX_MAP,
        ...syntaxMap
    };
}

/**
 * 为特定语法角色添加词汇
 * @param role 语法角色
 * @param words 词汇列表
 * @param language 可选，特定语言ID
 */
export function addSyntaxWords(role: SyntaxRole, words: string[], language?: string): void {
    if (language) {
        // 添加到特定语言
        const langMap = LANGUAGE_SYNTAX_MAPS[language] || (LANGUAGE_SYNTAX_MAPS[language] = { ...COMMON_SYNTAX_MAP });
        langMap[role] = [...(langMap[role] || []), ...words];
    } else {
        // 添加到通用映射
        COMMON_SYNTAX_MAP[role] = [...(COMMON_SYNTAX_MAP[role] || []), ...words];
        // 更新所有语言映射
        for (const lang in LANGUAGE_SYNTAX_MAPS) {
            if (!LANGUAGE_SYNTAX_MAPS[lang][role]) {
                LANGUAGE_SYNTAX_MAPS[lang][role] = [...words];
            } else {
                LANGUAGE_SYNTAX_MAPS[lang][role] = [...LANGUAGE_SYNTAX_MAPS[lang][role], ...words];
            }
        }
    }
}

/**
 * 简化的上下文提取，用于装饰器
 * @param originalWord 原始单词
 * @param document 文档对象
 * @param position 位置
 * @returns 文档上下文
 */
export function createSimpleContext(originalWord: string, document: any, position: any): CodeContext {
    return {
        lineText: document.lineAt(position.line).text,
        wordIndex: position.character,
        languageId: document.languageId,
        indentation: 0
    };
}

/**
 * 根据原始单词获取适合的高亮颜色
 * 这是给decorator-manager使用的简化接口
 * @param originalWord 原始英文单词
 * @param document 文档对象
 * @param position 位置对象
 * @returns 适合的高亮颜色
 */
export function getSyntaxColor(originalWord: string, document: any, position: any): string {
    const context = createSimpleContext(originalWord, document, position);
    
    // 处理所有文件类型，即使不是受支持的编程语言
    if (!LANGUAGE_SYNTAX_MAPS[context.languageId]) {
        // 对于不支持的语言类型，使用通用语法映射
        // 尝试基于常见规则推断
        
        // 检查是否是驼峰式标识符（可能是变量名或函数名）
        if (/^[a-z][a-zA-Z0-9]*$/.test(originalWord) && /[A-Z]/.test(originalWord)) {
            return SYNTAX_COLORS[SyntaxRole.VARIABLE];
        }
        
        // 检查是否全大写（可能是常量）
        if (/^[A-Z][A-Z0-9_]*$/.test(originalWord)) {
            return SYNTAX_COLORS[SyntaxRole.VARIABLE];
        }
        
        // 检查是否看起来像函数名
        if (/^[a-zA-Z][a-zA-Z0-9]*\s*\(/.test(originalWord + context.followingChar)) {
            return SYNTAX_COLORS[SyntaxRole.FUNCTION];
        }
        
        // 检查是否看起来像属性
        if (context.precedingChar === '.') {
            return SYNTAX_COLORS[SyntaxRole.PROPERTY];
        }
        
        // 默认颜色
        return FALLBACK_COLOR;
    }
    
    return getHighlightColor(originalWord, context);
}

/**
 * 添加通用文件类型支持
 * 为所有未明确支持的文件类型提供基本的语法映射
 */
export function addGenericFileSupport() {
    // 添加HTML支持
    addLanguageSyntaxMap('html', {
        ...COMMON_SYNTAX_MAP,
        [SyntaxRole.KEYWORD]: ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'script', 'style', 'link', 'meta', 'title', 'form', 'input', 'button', 'select', 'option', 'table', 'tr', 'td', 'th', 'ul', 'li', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    });
    
    // 添加CSS支持
    addLanguageSyntaxMap('css', {
        ...COMMON_SYNTAX_MAP,
        [SyntaxRole.KEYWORD]: ['color', 'background', 'margin', 'padding', 'font', 'display', 'position', 'width', 'height', 'border', 'flex', 'grid', 'text-align', 'align-items', 'justify-content']
    });
    
    // 添加Vue支持 - 组合HTML, CSS和JavaScript
    addLanguageSyntaxMap('vue', {
        ...JS_TS_SYNTAX_MAP,
        [SyntaxRole.KEYWORD]: [
            ...JS_TS_SYNTAX_MAP[SyntaxRole.KEYWORD],
            'template', 'script', 'style', 'v-if', 'v-else', 'v-for', 'v-bind', 'v-on', 'v-model',
            'components', 'props', 'data', 'methods', 'computed', 'watch', 'created', 'mounted'
        ]
    });
    
    // 添加通用纯文本支持
    addLanguageSyntaxMap('plaintext', COMMON_SYNTAX_MAP);
    
    // 添加XML支持
    addLanguageSyntaxMap('xml', {
        ...COMMON_SYNTAX_MAP,
        [SyntaxRole.KEYWORD]: ['xml', 'version', 'encoding', 'xmlns', 'xsi', 'schema']
    });
    
    // 添加JSON支持
    addLanguageSyntaxMap('json', {
        ...COMMON_SYNTAX_MAP,
        [SyntaxRole.PROPERTY]: ['name', 'version', 'description', 'main', 'scripts', 'dependencies', 'devDependencies', 'author', 'license']
    });
    
    // 添加Markdown支持
    addLanguageSyntaxMap('markdown', {
        ...COMMON_SYNTAX_MAP
    });
}

// 在文件顶部调用函数，确保在导出前注册所有类型
addGenericFileSupport(); 