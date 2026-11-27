// 検査の動作を確かめるためのサンプル。3 つのフレームワークで同じ不具合を仕込んでいる。
import { createApp, onMounted, onUnmounted, ref } from "vue/dist/vue.esm-bundler.js";

createApp({
  setup() {
    const tip = ref(false);
    const panel = ref(false);
    const count = ref(0);
    const opened = ref(false);
    const onKey = (event) => {
      if (event.key === "k") panel.value = true;
      if (event.key === "Escape") panel.value = false;
    };
    onMounted(() => document.addEventListener("keydown", onKey));
    onUnmounted(() => document.removeEventListener("keydown", onKey));
    const sort = (event) => (location.href = `../good.html?sort=${event.target.value}`);
    return { tip, panel, count, opened, sort };
  },
  template: `
    <main>
      <h1 id="ready">Vue のサンプル</h1>
      <p><label>メールアドレス <input id="email" type="email" name="email"></label></p>
      <div id="card" class="box" @click="opened = true">クリックで開く領域{{ opened ? " (開きました)" : "" }}</div>
      <div id="pad" class="box" @pointerdown="count++">押した時点で数える領域</div>
      <span class="tip-wrap">
        <button id="help" type="button" @mouseenter="tip = true" @mouseleave="tip = false">説明を表示</button>
        <span v-if="tip" id="tip" class="tip">ポインタを載せられない説明</span>
      </span>
      <p><label>並び順
        <select id="sort" @change="sort">
          <option value="new">新しい順</option>
          <option value="old">古い順</option>
        </select>
      </label></p>
      <p><button id="save" type="button" @click="count++">保存する</button></p>
      <p id="count" role="status">保存した回数: {{ count }}</p>
      <div v-if="panel" id="panel">ショートカットで開いた領域</div>
    </main>
  `,
}).mount("#app");
