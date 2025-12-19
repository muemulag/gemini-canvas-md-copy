/**
 * content.js v56.0 "Golden Master" Edition
 * * ベース: ユーザー様提供の v52.2 (動作実績あり・フルコメント版)
 * * 修正: Markdownの変換ロジックのみ、評価の高かった強化版に差し替え。
 * * 目的: 信頼性の高い動作ロジックと詳細なコメントを維持しつつ、Markdownの再現性を向上させる。
 */

// ---------------------------------------------------------
// Global Singleton & State
// ---------------------------------------------------------
// ページリロードなしで拡張機能を更新した場合の多重起動を防止するためのチェック
// 古いバージョンのインスタンスが残っていないか確認する
if (window.__GEMINI_DL_INSTANCE__) {
    // 既に誰かがいる場合、そのインスタンスを無効化するシグナルを送る等の処理は難しいので
    // 今回は新しいインスタンスとして上書きするが、ログを残す
    console.warn("[Gemini DL] New instance loaded. Previous instance might still be active. Please Reload Page.");
}
window.__GEMINI_DL_INSTANCE__ = "v56.0";

// ---------------------------------------------------------
// Shadow DOM 貫通検索ヘルパー
// ---------------------------------------------------------

/**
 * querySelectorAllDeep
 * ルート要素からShadow DOMを含めて再帰的にセレクタに一致する「全て」の要素を探す関数。
 * GeminiのUIはShadow DOMでカプセル化されている部分が多いため、通常のdocument.querySelectorAllでは
 * 要素が見つからない場合がある。この関数でその壁を突破する。
 *
 * @param {string} selector - 検索するCSSセレクタ
 * @param {Element|Document} root - 検索開始地点（デフォルトはdocument）
 * @param {Array} results - 再帰呼び出し用の結果格納配列
 * @returns {Array} 見つかった要素の配列
 */
function querySelectorAllDeep(selector, root = document, results = []) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
        results.push(el);
    }
    // すべての要素を走査し、Shadow Rootを持っている要素があればその中も再帰的に探す
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            querySelectorAllDeep(selector, el.shadowRoot, results);
        }
    }
    return results;
}

/**
 * querySelectorDeep
 * ルート要素からShadow DOMを含めて再帰的にセレクタに一致する「最初」の要素を探す関数。
 * 特定のコンテナ（エディタパネルなど）をピンポイントで探す際に使用する。
 *
 * @param {string} selector - 検索するCSSセレクタ
 * @param {Element|Document} root - 検索開始地点
 * @returns {Element|null} 見つかった要素、またはnull
 */
function querySelectorDeep(selector, root = document) {
    let element = root.querySelector(selector);
    if (element) return element;
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            const found = querySelectorDeep(selector, el.shadowRoot);
            if (found) return found;
        }
    }
    return null;
}

// ---------------------------------------------------------
// ボタン注入ロジック
// ---------------------------------------------------------
const BTN_CLASS = 'gemini-canvas-dl-btn-v56'; // バージョン固有クラス（競合回避用）

/**
 * injectButtonsToToolbars
 * Canvasのツールバーを探し出し、そこに「DLボタン」を挿入するメイン関数。
 * MutationObserverによってDOMの変化（Canvasが開かれた時など）に合わせて繰り返し呼び出される。
 * * 処理の流れ:
 * 1. 古いバージョンのボタンを掃除する。
 * 2. ターゲットとなるツールバー内のコンテナ(.action-buttons等)を探す。
 * 3. コンテナが見つかったら、まだボタンがない場合に限り、新規ボタンを作成して挿入する。
 */
function injectButtonsToToolbars() {
    // 1. 古いボタンの掃除 (他バージョンのボタンも全て消す)
    // 拡張機能をリロードした際などに、古いボタンが画面に残ってしまうのを防ぐための「亡霊退治」処理
    const oldButtons = querySelectorAllDeep(`button[class*="gemini-canvas-dl-btn"]`);
    for (const b of oldButtons) {
        if (b.className !== BTN_CLASS) {
            b.remove(); // 古いボタンをDOMから抹消
        }
    }

    // ターゲットとなるコンテナを探す (.action-buttons や .right-panel)
    // これらはCanvas右上の「共有」や「閉じる」ボタンが入っている領域
    const actionContainers = querySelectorAllDeep('.action-buttons, .right-panel');

    for (const container of actionContainers) {
        // 既に現行バージョンのボタンがあるなら何もしない
        if (container.querySelector('.' + BTN_CLASS)) continue;
        
        // 親がツールバーであることを確認（無関係な場所にボタンが出るのを防ぐ）
        if (!container.closest('toolbar, .toolbar')) continue;

        // ボタン要素の作成
        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.innerHTML = '<span>💾</span> DL';
        btn.title = '上書き保存でダウンロード';
        
        // GeminiのUIに馴染むスタイルを適用
        btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            height: 32px;
            padding: 0 16px;
            margin: 0 4px;
            background-color: #1a73e8;
            color: white;
            border: none;
            border-radius: 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
            vertical-align: middle;
            z-index: 100;
        `;
        
        // ホバー効果
        btn.onmouseover = () => btn.style.backgroundColor = "#1557b0";
        btn.onmouseout = () => btn.style.backgroundColor = "#1a73e8";
        
        // クリックイベントの設定
        // onclickプロパティを使うことで、リスナーの多重登録を物理的に防ぐ
        btn.onclick = (e) => handleDownloadAction(e, btn);

        // コンテナの先頭（左端）に挿入する
        container.insertBefore(btn, container.firstChild);
    }
}

// ---------------------------------------------------------
// メイン処理
// ---------------------------------------------------------
let isProcessing = false; // 排他制御用フラグ（連打防止）

/**
 * handleDownloadAction
 * DLボタンがクリックされたときに実行されるメイン処理。
 * ファイル名の特定、コンテンツの取得、ダウンロードの実行を一括して行う。
 *
 * @param {Event} e - クリックイベント
 * @param {HTMLButtonElement} btn - クリックされたDLボタン要素
 */
async function handleDownloadAction(e, btn) {
    e.stopPropagation(); // 親要素へのイベント伝播を止める
    e.preventDefault();

    if (isProcessing) return; // 処理中なら何もしない（排他制御）
    isProcessing = true;

    const originalContent = btn.innerHTML;
    btn.innerHTML = '🤖'; // 処理中アイコンに変更
    btn.style.backgroundColor = "#e37400"; // オレンジ色に変更

    try {
        // 1. ファイル名の取得
        // まずはDOM構造から、次に座標からファイル名を探す
        let filename = determineFilenameForce(btn);
        
        // 空チェック・デフォルト値設定
        if (!filename || filename.trim() === "") {
             filename = "Gemini_Canvas_Artifact";
        }
        
        console.log("[Gemini DL] Filename detected:", filename);

        // 2. コンテンツの取得
        let content = "";
        // Markdown表示エリアを探す (ユーザー提供パスに基づく)
        const markdownContainer = querySelectorDeep('extended-response-panel > div, .markdown-content');
        
        // ファイル名がMarkdownっぽいか、または拡張子がなくてMarkdownコンテナがある場合
        const isMarkdown = filename.toLowerCase().endsWith('.md') || (!filename.includes('.') && markdownContainer);
        
        if (isMarkdown && markdownContainer) {
            // Markdownの場合:
            // 画面上のHTML構造からMarkdown記法(#, -など)を復元する「逆コンパイル」を行う
            console.log("[Gemini DL] Markdown detected. Converting HTML to Markdown...");
            content = convertHtmlToMarkdown(markdownContainer);
        } else {
            // コードの場合:
            // エディタから直接テキストを取得するか、共有ボタン経由でクリップボードから取得する
            console.log("[Gemini DL] Code detected. Extracting...");
            content = await tryExtractCode(btn);
        }

        // コンテンツが取れなかった場合の最終手段
        if (!content || content.trim().length === 0) {
            if (markdownContainer) {
                content = markdownContainer.innerText; // 書式は崩れるがテキストは確保
            } else {
                throw new Error("コンテンツを取得できませんでした。");
            }
        }

        // 3. 拡張子の補完
        // ファイル名に拡張子が含まれていない場合、コンテンツの中身から推測して付与する
        if (!filename.includes('.')) {
             filename += guessExtension(content);
        }
        
        // サニタイズ: ファイル名に使えない文字をアンダースコアに置換
        filename = filename.replace(/[\\/:*?"<>|]/g, "_");

        console.log("[Gemini DL] Final Filename:", filename);

        // 4. ダウンロード実行 (Background経由)
        // background.js にメッセージを送り、ChromeのダウンロードAPIで保存（上書き対応）
        await triggerDownloadViaBackground(filename, content);
        
        // 成功表示
        btn.innerHTML = '✅';
        btn.style.backgroundColor = "#0b8043"; // 緑色
        
        // メニューが開いたままなら閉じる（共有ボタン経由の場合など）
        document.body.click(); 

    } catch (err) {
        console.error("[Gemini DL] Error:", err);
        
        // エラー時の表示
        if (err.message.includes("バックグラウンド")) {
            alert("拡張機能の通信エラーです。\nページをリロード(F5)してください。");
        } else {
            // エラーでもアラートを出さず、ボタンを赤くするだけにする（ユーザー体験優先）
            // alert("エラー: " + err.message); 
        }
        
        btn.innerHTML = '⚠️';
        btn.title = err.message; // エラー内容をツールチップへ
        btn.style.backgroundColor = "#d93025"; // 赤色
    } finally {
        // 一定時間後にボタンの状態を元に戻し、ロックを解除
        setTimeout(() => {
            btn.innerHTML = originalContent;
            btn.style.backgroundColor = "#1a73e8";
            btn.title = '上書き保存でダウンロード';
            isProcessing = false;
        }, 2000);
    }
}

// ---------------------------------------------------------
// Helper Functions (補助関数群)
// ---------------------------------------------------------

/**
 * determineFilenameForce
 * 画面上のどこにファイル名（タイトル）があるかを特定する関数。
 * Shadow DOMの壁を越えるため、DOMツリー構造だけでなく「座標（見た目の位置）」も使って探す。
 *
 * @param {HTMLElement} btn - クリックされたDLボタン
 * @returns {string} 特定されたファイル名
 */
function determineFilenameForce(btn) {
    // 戦略1: 構造探索 (closest)
    // ボタンの親であるツールバーの中にタイトルがあるか探す（これが一番確実）
    const toolbar = btn.closest('toolbar, .toolbar');
    if (toolbar) {
        // ユーザー提供情報: toolbar > div.left-panel > h2
        const leftPanel = toolbar.querySelector('.left-panel');
        if (leftPanel) {
            const h2 = leftPanel.querySelector('h2');
            if (h2 && h2.innerText.trim().length > 0) return h2.innerText.trim();
        }
        // フォールバック: クラス名 title-text
        const titleEl = toolbar.querySelector('.title-text, h2');
        if (titleEl && titleEl.innerText.trim().length > 0) return titleEl.innerText.trim();
    }

    // 戦略2: 座標探索 (Visual Fallback)
    // 構造探索で見つからなかった場合、ボタンの「左隣」にあるタイトルっぽい要素を探す
    const btnRect = btn.getBoundingClientRect();
    const candidates = querySelectorAllDeep('h2, .title-text, input[aria-label="Document title"]');
    
    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of candidates) {
        if (el.offsetParent === null) continue; // 見えていないものは除外
        
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // 高さチェック: ボタンと同じ水平線上にあるか (誤差 ±60px)
        const yDiff = Math.abs((rect.top + rect.height/2) - (btnRect.top + btnRect.height/2));
        if (yDiff > 60) continue;

        // 位置チェック: ボタンより左側にあるか
        if (rect.left >= btnRect.left) continue;

        // 距離計算: 一番近いものを探す
        const distance = Math.sqrt(Math.pow(rect.right - btnRect.left, 2) + Math.pow(rect.top - btnRect.top, 2));

        if (distance < minDistance) {
            minDistance = distance;
            bestCandidate = el;
        }
    }

    if (bestCandidate) {
        const val = (bestCandidate.value || bestCandidate.innerText).trim();
        if (val.length > 0) return val;
    }

    return ""; // 見つからなかった場合
}

/**
 * tryExtractCode
 * コードエディタの内容を取得する関数。
 * まずエディタ(textarea)の直接取得を試み、ダメなら共有ボタン→コピーの自動操作を行う。
 * v52.2のハイブリッドロジックを維持。
 *
 * @param {HTMLElement} btn - クリックされたDLボタン
 * @returns {Promise<string|null>} 取得したコードテキスト
 */
async function tryExtractCode(btn) {
    // 1. エディタ直接取得 (textareaを探す)
    const toolbar = btn.closest('toolbar, .toolbar');
    let panel = toolbar ? toolbar.parentElement : null;
    if (panel) {
        const textarea = panel.querySelector('textarea, [contenteditable]');
        if (textarea) return textarea.value || textarea.textContent;
    }

    // 2. 共有ボタンオートメーション (隣の隣にあるボタンを探す)
    const next1 = btn.nextElementSibling;
    const targetContainer = next1 ? next1.nextElementSibling : null;
    let targetBtn = null;
    
    // コンテナ内のボタンを探す
    if (targetContainer) targetBtn = targetContainer.querySelector('button') || targetContainer;
    // なければ親から再検索 (data-test-id="share-button")
    if (!targetBtn && btn.parentElement) targetBtn = btn.parentElement.querySelector('button[data-test-id="share-button"]');

    if (targetBtn) {
        // 共有ボタンをクリックしてメニューを開く
        targetBtn.click();
        
        // メニューが開くのを待ち、その中の「内容をコピー」ボタンを探す
        const copyBtn = await waitForCopyButtonInOverlay();
        if (copyBtn) {
            // クリックイベントを発火（念の為マウスオーバーも送る）
            copyBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            copyBtn.click();
            
            // クリップボード書き込み待ち
            await new Promise(r => setTimeout(r, 600));
            // クリップボードからテキスト取得
            return await navigator.clipboard.readText();
        }
    }
    return null;
}

/**
 * convertHtmlToMarkdown
 * HTML構造を解析して、Markdownテキストに変換する関数。
 * ★ v52.2の関数をベースに、v39/54の強化された変換ルール（強調、リンク等）を追加・統合。
 *
 * @param {HTMLElement} element - Markdownコンテナ要素
 * @returns {string} 復元されたMarkdownテキスト
 */
function convertHtmlToMarkdown(element) {
    let md = '';
    
    for (const node of element.childNodes) {
        // テキストノードの場合
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text.length > 0) md += text;
            continue;
        }
        
        // 要素ノードの場合
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            if (window.getComputedStyle(node).display === 'none') continue;
            
            // 再帰的に中身を変換
            const innerContent = convertHtmlToMarkdown(node);
            
            // タグに応じたMarkdown記法の適用
            switch (tagName) {
                case 'h1': md += `\n# ${innerContent}\n\n`; break;
                case 'h2': md += `\n## ${innerContent}\n\n`; break;
                case 'h3': md += `\n### ${innerContent}\n\n`; break;
                case 'h4': md += `\n#### ${innerContent}\n\n`; break;
                
                case 'p':  md += `${innerContent}\n\n`; break;
                case 'div': md += `${innerContent}\n`; break;
                case 'br': md += `\n`; break;
                
                // 【強化ポイント】v52.2になかった強調・リンク・画像・水平線の処理を追加
                case 'strong': case 'b':  md += ` **${innerContent}** `; break;
                case 'em': case 'i':  md += ` *${innerContent}* `; break;
                case 'a': md += `[${innerContent}](${node.getAttribute('href')||''})`; break;
                case 'img': md += `![${node.getAttribute('alt')||''}](${node.getAttribute('src')||''})`; break;
                case 'hr': md += `\n---\n\n`; break;

                case 'li': md += `- ${innerContent}\n`; break; // リスト
                case 'pre': md += `\n\`\`\`\n${node.innerText}\n\`\`\`\n\n`; continue; // コードブロックはinnerTextで改行維持
                case 'code': if (node.parentElement.tagName !== 'PRE') md += ` \`${innerContent}\` `; break; // インラインコード
                
                default: md += innerContent;
            }
        }
    }
    // 連続する空行を整理して返す
    return md.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * guessExtension
 * コンテンツの中身から適切な拡張子を推測する関数。
 * ファイル名に拡張子がない場合のフォールバック用。
 *
 * @param {string} text - ファイルの中身
 * @returns {string} 推測された拡張子（.mdなど）
 */
function guessExtension(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('# ') || trimmed.includes('## ')) return '.md';
    if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) return '.html';
    if (trimmed.startsWith('import ') || trimmed.includes('function ')) return '.js';
    if (trimmed.includes('def ') || trimmed.includes('class ')) return '.py';
    return '.md'; // デフォルト
}

/**
 * waitForCopyButtonInOverlay
 * 「共有」ボタンを押した後に開くメニュー（オーバーレイ）の中から、
 * 「コピー」ボタンが出現するのを待機して特定する関数。
 *
 * @returns {Promise<HTMLElement|null>} コピーボタン要素
 */
function waitForCopyButtonInOverlay() {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            attempts++;
            // メニューパネル（cdk-overlay-pane等）を探す
            const overlays = document.querySelectorAll('.cdk-overlay-pane, .mat-mdc-menu-panel, [role="menu"]');
            for (const overlay of overlays) {
                if (overlay.offsetWidth > 0) {
                    // その中から「コピー」ボタンを探す
                    const target = overlay.querySelector('copy-button button') || 
                                   overlay.querySelector('button[data-test-id="copy-button"]') || 
                                   Array.from(overlay.querySelectorAll('button, [role="menuitem"]')).find(el => el.innerText.includes('コピー'));
                    if (target) { resolve(target); return; }
                }
            }
            if (attempts > 30) resolve(null); // タイムアウト
            else setTimeout(check, 100); // 再試行
        };
        check();
    });
}

// ---------------------------------------------------------
// ダウンロード機能 (Background経由)
// ---------------------------------------------------------

/**
 * triggerDownloadViaBackground
 * content.jsからbackground.jsへメッセージを送り、上書き保存を実行させる関数。
 *
 * @param {string} filename - 保存するファイル名
 * @param {string} content - ファイルの中身
 * @returns {Promise} 保存処理の完了を待つPromise
 */
function triggerDownloadViaBackground(filename, content) {
    return new Promise((resolve, reject) => {
        // 改行コードの正規化 (LF -> CRLF) と NBSPの置換
        let normalized = content.replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
        
        // Blobを作成 (text/markdownとして扱うことでブラウザの挙動を安定させる)
        const blob = new Blob([normalized], { type: 'text/markdown; charset=utf-8' });
        const reader = new FileReader();
        
        reader.onload = function() {
            const dataUrl = reader.result;
            
            try {
                // background.js に送信
                chrome.runtime.sendMessage({
                    action: "download",
                    filename: filename,
                    url: dataUrl
                }, (response) => {
                    // background.jsからの返信を確認
                    if (chrome.runtime.lastError) {
                        reject(new Error("通信エラー: リロードしてください"));
                    } else if (response && response.status === 'success') {
                        resolve();
                    } else {
                        reject(new Error("保存失敗"));
                    }
                });
            } catch (e) {
                reject(new Error("通信開始エラー"));
            }
        };
        reader.readAsDataURL(blob);
    });
}

// ---------------------------------------------------------
// オブザーバー (監視開始)
// ---------------------------------------------------------
// DOMの変化を監視し、Canvasが開かれたら即座にボタンを注入する
const observer = new MutationObserver(() => {
  injectButtonsToToolbars();
});
observer.observe(document.body, { childList: true, subtree: true });

// 初回実行
injectButtonsToToolbars();