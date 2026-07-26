import type { Extension } from "@codemirror/state";
import { livePreviewDecorations } from "./decorations";
import { livePreviewPointerSelection, livePreviewReferenceNavigation } from "./interactions";
import { configureLivePreviewVimNavigation } from "./vertical-motion";

export function livePreviewExtension(): Extension {
  configureLivePreviewVimNavigation();
  return [
    livePreviewDecorations,
    livePreviewPointerSelection,
    livePreviewReferenceNavigation,
  ];
}

export { propertyIconConfig, type PropertyIconConfig } from "./property-icons";
export {
  configureLivePreviewVimNavigation,
  livePreviewVerticalTarget,
  moveLivePreviewVertically,
} from "./vertical-motion";
