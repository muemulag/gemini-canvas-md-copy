/**
 * background.js v14.0 "Strict Overwrite" Edition
 * * タイムスタンプ付与機能を削除。
 * * 指定されたファイル名で保存し、同名ファイルがある場合は強制的に上書きする。
 * * ソースコードとしての整合性を最優先。
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "download") {
    
    chrome.downloads.download({
      url: request.url,
      filename: request.filename, // content.jsから送られたファイル名をそのまま使う
      conflictAction: 'overwrite', // 同名ファイルは警告なしで上書き
      saveAs: false
    }, (downloadId) => {
      // Chrome APIのコールバック内で返信
      if (chrome.runtime.lastError) {
        console.error("Download failed:", chrome.runtime.lastError);
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
      } else {
        console.log("Download started:", downloadId);
        sendResponse({ status: 'success', id: downloadId });
      }
    });

    return true; // 非同期レスポンスのためにtrueを返す
  }
});