import { EditorView, WidgetType } from "@codemirror/view";
import { renderPropertyIconSvg } from "../../icons/property-icon-nodes.ts";

export class PropertyIconWidget extends WidgetType {
  private property: string;
  private icon: string;
  private openPicker: (property: string) => void;

  constructor(property: string, icon: string, openPicker: (property: string) => void) {
    super();
    this.property = property;
    this.icon = icon;
    this.openPicker = openPicker;
  }
  // The callback is referentially stable, so identity is fully described by the row.
  eq(widget: PropertyIconWidget) {
    return widget.property === this.property && widget.icon === this.icon;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-live-property-icon";
    button.dataset.property = this.property;
    button.tabIndex = -1;
    button.setAttribute("aria-label", `Change the ${this.property} property icon`);
    button.append(renderPropertyIconSvg(this.icon));
    // Front matter reverts to raw YAML once the cursor moves into it, which
    // would remove the very row being configured.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      this.openPicker(this.property);
    });
    return button;
  }
}

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
