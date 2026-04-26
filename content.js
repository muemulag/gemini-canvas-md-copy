/**
 * content.js v1
 * * 機能: Markdown形式でクリップボードにコピー。
 */

// ---------------------------------------------------------
// Global Singleton & State
// ---------------------------------------------------------
// ページリロードなしで拡張機能を更新した場合の多重起動を防止するためのチェック
// 古いバージョンのインスタンスが残っていないか確認する
if (window.__GEMINI_DL_INSTANCE__) {
  // 既に誰かがいる場合、そのインスタンスを無効化するシグナルを送る等の処理は難しいので
  // 今回は新しいインスタンスとして上書きするが、ログを残す
  console.warn(
    "[Gemini DL] New instance loaded. Previous instance might still be active. Please Reload Page.",
  );
}
window.__GEMINI_DL_INSTANCE__ = "v1.0.0";

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
  const allElements = root.querySelectorAll("*");
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
  const allElements = root.querySelectorAll("*");
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
const BTN_CLASS = "gemini-canvas-copy-btn-v1_0_0"; // バージョン固有クラス（競合回避用）

/**
 * injectButtonsToToolbars
 * Canvasのツールバーを探し出し、そこに「コピー」ボタンを挿入するメイン関数。
 * MutationObserverによってDOMの変化（Canvasが開かれた時など）に合わせて繰り返し呼び出される。
 * * 処理の流れ:
 * 1. 古いバージョンのボタンを掃除する。
 * 2. ターゲットとなるツールバー内のコンテナ(.action-buttons等)を探す。
 * 3. コンテナが見つかったら、まだボタンがない場合に限り、新規ボタンを作成して挿入する。
 */
function injectButtonsToToolbars() {
  // 1. 古いボタンの掃除
  // クラス名が完全に一致するかではなく、特定のクラスを持っているかで判定する
  const allPossibleButtons = querySelectorAllDeep(
    `button[class*="gemini-canvas-copy-btn"]`,
  );
  for (const b of allPossibleButtons) {
    if (!b.classList.contains(BTN_CLASS)) {
      b.remove();
    }
  }

  // ターゲットとなるコンテナを探す
  const actionContainers = querySelectorAllDeep(
    '.action-buttons, .right-panel, [class*="action-buttons"]',
  );

  for (const container of actionContainers) {
    // 既に現行バージョンのボタンがあるなら何もしない
    if (container.querySelector("." + BTN_CLASS)) continue;

    // ボタン要素の作成
    const btn = document.createElement("button");
    btn.classList.add(BTN_CLASS); // className ではなく classList を使用
    btn.innerHTML = "Copy as Markdown";
    btn.title = "Markdown形式でコピー (選択範囲がある場合はその部分のみ)";

    // GeminiのUIに馴染むスタイルを適用 (ダークモード対応)
    btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 28px;
            padding: 0 12px;
            margin: 0 8px;
            background-color: transparent;
            color: inherit;
            border: 1px solid rgba(128, 128, 128, 0.5);
            border-radius: 14px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            cursor: pointer;
            transition: all 0.2s;
            vertical-align: middle;
            z-index: 100;
            opacity: 0.8;
        `;

    // ホバー効果
    btn.onmouseover = () => {
      btn.style.backgroundColor = "rgba(128, 128, 128, 0.1)";
      btn.style.opacity = "1";
    };
    btn.onmouseout = () => {
      btn.style.backgroundColor = "transparent";
      btn.style.opacity = "0.8";
    };

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
  btn.innerHTML = "WAIT..."; // 処理中
  btn.style.opacity = "0.5";

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

    // --- 選択範囲のチェック (最優先) ---
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      selection.toString().trim().length > 0
    ) {
      console.log(
        "[Gemini DL] Selection detected. Converting selection to Markdown...",
      );
      const range = selection.getRangeAt(0);
      const container = document.createElement("div");
      container.appendChild(range.cloneContents());

      content = convertHtmlToMarkdown(container);
      // 万が一Markdown変換で空になった場合は、プレーンテキストとして取得
      if (!content || content.trim().length === 0) {
        content = selection.toString();
      }
    }

    // Markdown表示エリアを探す
    // より正確なコンテンツ抽出のため、セレクタを優先順位順に調整
    const markdownContainer = querySelectorDeep(
      "#extended-response-markdown-content, .ProseMirror, .markdown-content, extended-response-panel div.container",
    );

    // ファイル名がMarkdownっぽいか、または拡張子がなくてMarkdownコンテナがある場合
    const isMarkdown =
      filename.toLowerCase().endsWith(".md") ||
      (!filename.includes(".") && markdownContainer);

    // 選択範囲がなかった場合のみ、全体のコンテンツを取得
    if (!content) {
      if (isMarkdown && markdownContainer) {
        // Markdownの場合:
        // 画面上のHTML構造からMarkdown記法(#, -など)を復元する「逆コンパイル」を行う
        console.log(
          "[Gemini DL] Markdown detected. Converting HTML to Markdown...",
        );
        content = convertHtmlToMarkdown(markdownContainer);
      } else {
        // コードの場合:
        // エディタから直接テキストを取得するか、共有ボタン経由でクリップボードから取得する
        console.log("[Gemini DL] Code detected. Extracting...");
        content = await tryExtractCode(btn);
      }
    }

    // コンテンツが取れなかった場合の最終手段
    if (!content || content.trim().length === 0) {
      if (markdownContainer) {
        content = markdownContainer.innerText; // 書式は崩れるがテキストは確保
      } else {
        throw new Error("コンテンツを取得できませんでした。");
      }
    }

    // 3. Markdown形式への整形
    // コードの場合（Markdownコンテナがない場合）は、バックティックで囲む
    if (!isMarkdown && content) {
      const ext = filename.includes(".")
        ? filename.split(".").pop()
        : guessExtension(content).replace(".", "");
      content = `\`\`\`${ext}\n${content}\n\`\`\``;
    }

    console.log("[Gemini DL] Final Content Length:", content.length);

    // 4. クリップボードにコピー
    await navigator.clipboard.writeText(content);

    // 成功表示
    btn.innerHTML = "DONE!";
    btn.style.color = "#34a853"; // Google Green
    btn.style.borderColor = "#34a853";

    // メニューが開いたままなら閉じる（共有ボタン経由の場合など）
    document.body.click();
  } catch (err) {
    console.error("[Gemini DL] Error:", err);

    btn.innerHTML = "FAIL";
    btn.style.color = "#ea4335"; // Google Red
    btn.style.borderColor = "#ea4335";
    btn.title = err.message; // エラー内容をツールチップへ
  } finally {
    // 一定時間後にボタンの状態を元に戻し、ロックを解除
    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.style.color = "inherit";
      btn.style.borderColor = "rgba(128, 128, 128, 0.5)";
      btn.style.opacity = "0.8";
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
  const toolbar = btn.closest("toolbar, .toolbar");
  if (toolbar) {
    // ユーザー提供情報: toolbar > div.left-panel > h2
    const leftPanel = toolbar.querySelector(".left-panel");
    if (leftPanel) {
      const h2 = leftPanel.querySelector("h2");
      if (h2 && h2.innerText.trim().length > 0) return h2.innerText.trim();
    }
    // フォールバック: クラス名 title-text
    const titleEl = toolbar.querySelector(".title-text, h2");
    if (titleEl && titleEl.innerText.trim().length > 0)
      return titleEl.innerText.trim();
  }

  // 戦略2: 座標探索 (Visual Fallback)
  // 構造探索で見つからなかった場合、ボタンの「左隣」にあるタイトルっぽい要素を探す
  const btnRect = btn.getBoundingClientRect();
  const candidates = querySelectorAllDeep(
    'h2, .title-text, input[aria-label="Document title"]',
  );

  let bestCandidate = null;
  let minDistance = Infinity;

  for (const el of candidates) {
    if (el.offsetParent === null) continue; // 見えていないものは除外

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // 高さチェック: ボタンと同じ水平線上にあるか (誤差 ±60px)
    const yDiff = Math.abs(
      rect.top + rect.height / 2 - (btnRect.top + btnRect.height / 2),
    );
    if (yDiff > 60) continue;

    // 位置チェック: ボタンより左側にあるか
    if (rect.left >= btnRect.left) continue;

    // 距離計算: 一番近いものを探す
    const distance = Math.sqrt(
      Math.pow(rect.right - btnRect.left, 2) +
        Math.pow(rect.top - btnRect.top, 2),
    );

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
  const toolbar = btn.closest("toolbar, .toolbar");
  let panel = toolbar ? toolbar.parentElement : null;
  if (panel) {
    const textarea = panel.querySelector("textarea, [contenteditable]");
    if (textarea) return textarea.value || textarea.textContent;
  }

  // 2. 共有ボタンオートメーション (隣の隣にあるボタンを探す)
  const next1 = btn.nextElementSibling;
  const targetContainer = next1 ? next1.nextElementSibling : null;
  let targetBtn = null;

  // コンテナ内のボタンを探す
  if (targetContainer)
    targetBtn = targetContainer.querySelector("button") || targetContainer;
  // なければ親から再検索 (data-test-id="share-button")
  if (!targetBtn && btn.parentElement)
    targetBtn = btn.parentElement.querySelector(
      'button[data-test-id="share-button"]',
    );

  if (targetBtn) {
    // 共有ボタンをクリックしてメニューを開く
    targetBtn.click();

    // メニューが開くのを待ち、その中の「内容をコピー」ボタンを探す
    const copyBtn = await waitForCopyButtonInOverlay();
    if (copyBtn) {
      // クリックイベントを発火（念の為マウスオーバーも送る）
      copyBtn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      copyBtn.click();

      // クリップボード書き込み待ち
      await new Promise((r) => setTimeout(r, 600));
      // クリップボードからテキスト取得
      return await navigator.clipboard.readText();
    }
  }
  return null;
}

/**
 * convertTableToMarkdown
 * table要素をMarkdown形式の表に変換する。
 *
 * @param {HTMLTableElement} table - テーブル要素
 * @returns {string} Markdown形式の表
 */
function convertTableToMarkdown(table) {
  let markdown = "";
  const rows = Array.from(table.rows);

  if (rows.length === 0) return "";

  rows.forEach((row, rowIndex) => {
    const cells = Array.from(row.cells);
    const cellContents = cells.map((cell) => {
      // セル内の改行はMarkdownの表構造を壊すため <br> に置換し、前後の空白を削る
      return convertHtmlToMarkdown(cell).trim().replace(/\n/g, "<br>");
    });

    if (cellContents.length > 0) {
      markdown += "| " + cellContents.join(" | ") + " |\n";

      // 最初の行（通常はヘッダー）の後にセパレーター行を挿入
      if (rowIndex === 0) {
        const separator = cells.map(() => "---");
        markdown += "| " + separator.join(" | ") + " |\n";
      }
    }
  });

  return markdown;
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
  // 要素自体がテーブルの場合の処理
  if (element.tagName && element.tagName.toLowerCase() === "table") {
    return convertTableToMarkdown(element);
  }

  // 自分たちが追加したボタン（BTN_CLASS）であれば無視する
  if (element.classList && element.classList.contains(BTN_CLASS)) {
    return "";
  }

  let md = "";

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

      // 非表示要素、または自分たちが追加したボタンであれば無視する
      if (
        window.getComputedStyle(node).display === "none" ||
        node.classList.contains(BTN_CLASS)
      ) {
        continue;
      }

      // テーブル要素の特別処理
      if (tagName === "table") {
        md += `\n\n${convertTableToMarkdown(node)}\n\n`;
        continue;
      }

      // 再帰的に中身を変換
      const innerContent = convertHtmlToMarkdown(node);

      // タグに応じたMarkdown記法の適用
      switch (tagName) {
        case "h1":
          md += `\n# ${innerContent}\n\n`;
          break;
        case "h2":
          md += `\n## ${innerContent}\n\n`;
          break;
        case "h3":
          md += `\n### ${innerContent}\n\n`;
          break;
        case "h4":
          md += `\n#### ${innerContent}\n\n`;
          break;

        case "p":
          md += `${innerContent}\n\n`;
          break;
        case "div":
          md += `${innerContent}\n`;
          break;
        case "br":
          md += `\n`;
          break;

        // 【強化ポイント】v52.2になかった強調・リンク・画像・水平線の処理を追加
        case "strong":
        case "b":
          md += ` **${innerContent}** `;
          break;
        case "em":
        case "i":
          md += ` *${innerContent}* `;
          break;
        case "a":
          md += `[${innerContent}](${node.getAttribute("href") || ""})`;
          break;
        case "img":
          md += `![${node.getAttribute("alt") || ""}](${
            node.getAttribute("src") || ""
          })`;
          break;
        case "hr":
          md += `\n---\n\n`;
          break;

        case "li":
          md += `- ${innerContent}\n`;
          break; // リスト
        case "pre":
          md += `\n\`\`\`\n${node.innerText}\n\`\`\`\n\n`;
          continue; // コードブロックはinnerTextで改行維持
        case "code":
          if (node.parentElement.tagName !== "PRE")
            md += ` \`${innerContent}\` `;
          break; // インラインコード

        // テーブル構成要素が単体で現れた場合のフォールバック（通常はtable内で処理される）
        case "tr":
          md += `${innerContent}\n`;
          break;
        case "td":
        case "th":
          md += `${innerContent} `;
          break;

        default:
          md += innerContent;
      }
    }
  }
  // 連続する空行を整理して返す
  return md.replace(/\n{3,}/g, "\n\n").trim();
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
  if (trimmed.startsWith("# ") || trimmed.includes("## ")) return ".md";
  if (trimmed.startsWith("<!DOCTYPE html") || trimmed.startsWith("<html"))
    return ".html";
  if (trimmed.startsWith("import ") || trimmed.includes("function "))
    return ".js";
  if (trimmed.includes("def ") || trimmed.includes("class ")) return ".py";
  return ".md"; // デフォルト
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
      const overlays = document.querySelectorAll(
        '.cdk-overlay-pane, .mat-mdc-menu-panel, [role="menu"]',
      );
      for (const overlay of overlays) {
        if (overlay.offsetWidth > 0) {
          // その中から「コピー」ボタンを探す
          const target =
            overlay.querySelector("copy-button button") ||
            overlay.querySelector('button[data-test-id="copy-button"]') ||
            Array.from(
              overlay.querySelectorAll('button, [role="menuitem"]'),
            ).find((el) => el.innerText.includes("コピー"));
          if (target) {
            resolve(target);
            return;
          }
        }
      }
      if (attempts > 30)
        resolve(null); // タイムアウト
      else setTimeout(check, 100); // 再試行
    };
    check();
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
