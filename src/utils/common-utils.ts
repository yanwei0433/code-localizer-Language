export function handleModifiedItems(
    identifiers: string[],
    modifiedIdentifiers: Record<string, string>,
    deletedItems: { identifiers: string[] }
): void {
    // 我们已经在实时事件处理中更新了数组，这里只需要记录日志
    if (modifiedIdentifiers && Object.keys(modifiedIdentifiers).length > 0) {
        console.log(`[CodeLocalizer] 用户修改了 ${Object.keys(modifiedIdentifiers).length} 个标识符`);
    }
    
    if (deletedItems) {
        if (deletedItems.identifiers && deletedItems.identifiers.length > 0) {
            console.log(`[CodeLocalizer] 用户删除了 ${deletedItems.identifiers.length} 个标识符`);
        }
    }
} 