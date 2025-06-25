// 配置管理模块，处理LLM配置和扩展设置
import * as vscode from 'vscode';
import { SUPPORTED_LANGUAGES } from '../vocabulary/vocabulary-storage';
import { getOllamaModels } from '../translation/translator';

/**
 * 获取扩展配置
 */
export function getExtensionConfig() {
    return vscode.workspace.getConfiguration('codeLocalizer');
}

/**
 * 获取目标语言
 */
export function getTargetLanguage(): string {
    const extensionConfig = getExtensionConfig();
    const userPreferredLanguage = extensionConfig.get<string>('targetLanguage');

    let targetLanguage: string;
    if (userPreferredLanguage && userPreferredLanguage.trim() !== '') {
        targetLanguage = userPreferredLanguage.trim();
        console.log(`Code Localizer: 使用用户定义的显示语言: ${targetLanguage}`);
    } else {
        targetLanguage = vscode.env.language;
        console.log(`Code Localizer: 使用VS Code的显示语言: ${targetLanguage}`);
    }
    
    console.log(`Code Localizer: 最终目标语言: ${targetLanguage}`);
    return targetLanguage;
}

/**
 * 设置目标语言
 * 显示所有支持的语言供用户选择
 */
export async function setTargetLanguage(): Promise<string | undefined> {
    try {
        // 准备显示语言名称的映射
        const languageNameMap: {[key: string]: string} = {
            'zh-CN': '简体中文 (zh-CN)',
            'zh-TW': '繁体中文 (zh-TW)',
            'ja': '日语 (ja)',
            'ko': '韩语 (ko)',
            'ru': '俄语 (ru)',
            'fr': '法语 (fr)',
            'de': '德语 (de)',
            'es': '西班牙语 (es)',
            'pt-BR': '葡萄牙语 (pt-BR)',
            'it': '意大利语 (it)',
            'tr': '土耳其语 (tr)'
        };
        
        // 获取当前设置的语言
        const currentLanguage = getTargetLanguage();
        
        // 准备选择项
        const languageOptions = SUPPORTED_LANGUAGES.map(lang => ({
            label: languageNameMap[lang] || lang,
            description: lang === currentLanguage ? '(当前选择)' : '',
            language: lang
        }));
        
        // 显示语言选择菜单
        const selectedOption = await vscode.window.showQuickPick(languageOptions, {
            placeHolder: '选择目标语言',
            title: '代码本地化目标语言'
        });
        
        if (!selectedOption) {
            return undefined; // 用户取消
        }
        
        // 更新设置
        const config = getExtensionConfig();
        await config.update('targetLanguage', selectedOption.language, vscode.ConfigurationTarget.Global);
        
        vscode.window.showInformationMessage(`已将目标语言设置为: ${selectedOption.label}`);
        
        return selectedOption.language;
    } catch (error) {
        console.error('[CodeLocalizer] 设置目标语言时出错:', error);
        vscode.window.showErrorMessage(`设置目标语言失败: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

/**
 * 获取LLM配置
 */
export function getLLMConfig() {
    const config = getExtensionConfig();
    // 由于现在只有ollamaApi，直接返回其配置
    return {
        provider: 'ollamaApi',
        apiUrl: config.get<string>('translationService.ollamaApiUrl', 'http://localhost:11434'),
        modelName: config.get<string>('translationService.ollamaModelName', 'gemma3:4b')
    };
}

/**
 * 配置Ollama LLM (原configLocalLLM，现只配置Ollama)
 */
export async function configLocalLLM(): Promise<void> { // 函数名保持不变以减少对调用处的修改
    try {
        const config = getExtensionConfig();

        // 直接进入Ollama API配置流程
        // 配置Ollama API
        const currentApiUrl = config.get<string>('translationService.ollamaApiUrl', 'http://localhost:11434');
        
        // API URL输入
        const newApiUrl = await vscode.window.showInputBox({
            prompt: '请输入Ollama API的URL',
            value: currentApiUrl,
            placeHolder: 'http://localhost:11434',
            title: 'Ollama API URL设置'
        });
        
        if (newApiUrl === undefined) {
            return; // 用户取消
        }
        
        // 保存API URL配置
        await config.update('translationService.ollamaApiUrl', newApiUrl.trim(), vscode.ConfigurationTarget.Global);
        
        // 获取Ollama可用模型
        const statusMessage = vscode.window.setStatusBarMessage('正在获取Ollama模型列表...');
        try {
            const models = await getOllamaModels(newApiUrl.trim());
            statusMessage.dispose();
            
            if (models.length === 0) {
                vscode.window.showErrorMessage('无法从Ollama获取模型列表。请确保Ollama服务正在运行并可访问。');
                // 允许用户手动输入模型名称，即使用户无法获取列表
            }
            
            // 显示模型选择菜单，即使models为空，也允许用户手动输入
            const modelOptions = models.map(modelName => ({
                label: modelName,
                description: isRecommendedModel(modelName) ? '(推荐用于翻译)' : ''
            }));
            
            const selectedModel = await vscode.window.showQuickPick(modelOptions, {
                placeHolder: models.length > 0 ? '选择要用于翻译的模型' : '未检测到模型，可手动输入或检查Ollama服务',
                title: 'Ollama模型选择'
            });
            
            if (selectedModel) { // 用户从列表中选择
                 await config.update('translationService.ollamaModelName', selectedModel.label, vscode.ConfigurationTarget.Global);
                 vscode.window.showInformationMessage(`已配置Ollama API (${newApiUrl.trim()}) 和模型 ${selectedModel.label}`);
            } else { // 用户可能取消了选择，或者列表为空时直接按了回车，此时我们检查是否需要手动输入
                const currentModelName = config.get<string>('translationService.ollamaModelName', '');
                const newModelName = await vscode.window.showInputBox({
                    prompt: '请输入Ollama模型名称 (例如 gemma3:4b)',
                    value: currentModelName, // 保留当前值或空字符串
                    placeHolder: 'gemma3:4b, llama3',
                    title: 'Ollama模型手动设置'
                });

                if (newModelName !== undefined && newModelName.trim() !== '') {
                    await config.update('translationService.ollamaModelName', newModelName.trim(), vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`已配置Ollama API (${newApiUrl.trim()}) 和手动设置的模型 ${newModelName.trim()}`);
                } else if (newModelName === undefined) {
                     vscode.window.showInformationMessage('Ollama模型配置已取消。');
                } else {
                    // 如果用户没有输入新模型名，且之前也没有模型名，可以给个提示
                    if(!currentModelName) {
                         vscode.window.showWarningMessage('未设置Ollama模型，翻译功能可能无法正常工作。');
                    }
                }
            }
        } catch (error) {
            statusMessage.dispose();
            vscode.window.showErrorMessage(`获取Ollama模型列表失败: ${error instanceof Error ? error.message : '未知错误'}`);
            // 即使获取列表失败，也允许用户手动输入模型名称
            const currentModelName = config.get<string>('translationService.ollamaModelName', '');
            const newModelName = await vscode.window.showInputBox({
                prompt: '无法获取Ollama模型列表，请手动输入模型名称',
                value: currentModelName,
                placeHolder: 'gemma3:4b, llama3',
                title: 'Ollama模型手动设置'
            });
            
            if (newModelName !== undefined && newModelName.trim() !== '') {
                await config.update('translationService.ollamaModelName', newModelName.trim(), vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`已配置Ollama API (${newApiUrl.trim()}) 和手动设置的模型 ${newModelName.trim()}`);
            } else if (newModelName === undefined) {
                 vscode.window.showInformationMessage('Ollama模型配置已取消。');
            }
        }

    } catch (error) {
        console.error('[CodeLocalizer] 配置LLM时出错:', error);
        vscode.window.showErrorMessage(`Code Localizer: 配置LLM失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// 判断是否是推荐用于翻译的模型
function isRecommendedModel(modelName: string): boolean {
    // 这些模型可能在翻译任务上表现较好
    const recommendedModels = [
        'qwen', 'gemma', 'llama', 'mistral', 'solar',
        'yi', 'wizard', 'babel', 'claude', 'phi', 'gpt'
    ];
    
    return recommendedModels.some(name => 
        modelName.toLowerCase().includes(name.toLowerCase()) ||
        modelName.toLowerCase().includes('translate')
    );
} 