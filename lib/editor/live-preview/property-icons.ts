import { Facet } from "@codemirror/state";
import type { PropertyIcons } from "../../property-icons.ts";

export type PropertyIconConfig = {
  icons: PropertyIcons;
  openPicker: (property: string) => void;
};

export const DEFAULT_PROPERTY_ICON_CONFIG: PropertyIconConfig = { icons: {}, openPicker: () => {} };

// Reconfigured through a compartment by the editor component. Each update
// supplies a fresh object, so decorations can detect changes by identity.
export const propertyIconConfig = Facet.define<PropertyIconConfig, PropertyIconConfig>({
  combine: (values) => values[0] ?? DEFAULT_PROPERTY_ICON_CONFIG,
});
