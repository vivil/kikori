// 検査の動作を確かめるためのサンプル。3 つのフレームワークで同じ不具合を仕込んでいる。
import "@angular/compiler";
import { Component, HostListener, signal } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

@Component({
  selector: "app-root",
  template: `
    <main>
      <h1 id="ready">Angular のサンプル</h1>
      <p><label>メールアドレス <input id="email" type="email" name="email"></label></p>
      <div id="card" class="box" (click)="opened.set(true)">クリックで開く領域{{ opened() ? " (開きました)" : "" }}</div>
      <div id="pad" class="box" (pointerdown)="add()">押した時点で数える領域</div>
      <span class="tip-wrap">
        <button id="help" type="button" (mouseenter)="tip.set(true)" (mouseleave)="tip.set(false)">説明を表示</button>
        @if (tip()) {
          <span id="tip" class="tip">ポインタを載せられない説明</span>
        }
      </span>
      <p><label>並び順
        <select id="sort" (change)="sort($event)">
          <option value="new">新しい順</option>
          <option value="old">古い順</option>
        </select>
      </label></p>
      <p><button id="save" type="button" (click)="add()">保存する</button></p>
      <p id="count" role="status">保存した回数: {{ count() }}</p>
      @if (panel()) {
        <div id="panel">ショートカットで開いた領域</div>
      }
    </main>
  `,
})
class AppComponent {
  tip = signal(false);
  panel = signal(false);
  count = signal(0);
  opened = signal(false);

  add(): void {
    this.count.update((n) => n + 1);
  }

  sort(event: Event): void {
    location.href = `../good.html?sort=${(event.target as HTMLSelectElement).value}`;
  }

  @HostListener("document:keydown", ["$event"])
  onKey(event: KeyboardEvent): void {
    if (event.key === "k") this.panel.set(true);
    if (event.key === "Escape") this.panel.set(false);
  }
}

bootstrapApplication(AppComponent).catch((error) => console.error(error));
