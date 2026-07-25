import { EditorView, WidgetType } from "@codemirror/view";

export class ImageWidget extends WidgetType {
  private src: string;
  private alt: string;

  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  eq(widget: ImageWidget) { return widget.src === this.src && widget.alt === this.alt; }
  toDOM(view: EditorView) {
    const figure = document.createElement("figure");
    figure.className = "cm-live-image";
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    const scheduleMeasure = () => window.requestAnimationFrame(() => view.requestMeasure());
    image.addEventListener("load", scheduleMeasure, { once: true });
    image.addEventListener("error", scheduleMeasure, { once: true });
    if (image.complete) scheduleMeasure();
    figure.append(image);
    if (this.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.alt;
      figure.append(caption);
    }
    return figure;
  }
}

export class BulletWidget extends WidgetType {
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-live-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

export class TaskCheckboxWidget extends WidgetType {
  private checked: boolean;
  private checkboxPosition: number;

  constructor(checked: boolean, checkboxPosition: number) {
    super();
    this.checked = checked;
    this.checkboxPosition = checkboxPosition;
  }
  eq(widget: TaskCheckboxWidget) {
    return widget.checked === this.checked && widget.checkboxPosition === this.checkboxPosition;
  }
  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "cm-live-task-checkbox";
    checkbox.checked = this.checked;
    checkbox.tabIndex = -1;
    checkbox.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    checkbox.addEventListener("mousedown", (event) => event.preventDefault());
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ changes: { from: this.checkboxPosition, to: this.checkboxPosition + 1, insert: this.checked ? " " : "x" } });
      view.focus();
    });
    return checkbox;
  }
}
