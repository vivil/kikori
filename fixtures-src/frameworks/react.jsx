// 検査の動作を確かめるためのサンプル。3 つのフレームワークで同じ不具合を仕込んでいる。
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [tip, setTip] = useState(false);
  const [panel, setPanel] = useState(false);
  const [count, setCount] = useState(0);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "k") setPanel(true);
      if (event.key === "Escape") setPanel(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main>
      <h1 id="ready">React のサンプル</h1>
      <p>
        <label>
          メールアドレス <input id="email" type="email" name="email" />
        </label>
      </p>
      <div id="card" className="box" onClick={() => setOpened(true)}>
        クリックで開く領域{opened ? " (開きました)" : ""}
      </div>
      <div id="pad" className="box" onPointerDown={() => setCount((n) => n + 1)}>
        押した時点で数える領域
      </div>
      <span className="tip-wrap">
        <button id="help" type="button" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
          説明を表示
        </button>
        {tip && (
          <span id="tip" className="tip">
            ポインタを載せられない説明
          </span>
        )}
      </span>
      <p>
        <label>
          並び順{" "}
          <select id="sort" defaultValue="new" onChange={(event) => (location.href = `../good.html?sort=${event.target.value}`)}>
            <option value="new">新しい順</option>
            <option value="old">古い順</option>
          </select>
        </label>
      </p>
      <p>
        <button id="save" type="button" onClick={() => setCount((n) => n + 1)}>
          保存する
        </button>
      </p>
      <p id="count" role="status">
        保存した回数: {count}
      </p>
      {panel && <div id="panel">ショートカットで開いた領域</div>}
    </main>
  );
}

createRoot(document.getElementById("app")).render(<App />);
