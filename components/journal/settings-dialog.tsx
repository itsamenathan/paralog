"use client";

import { WidgetLayoutEditor } from "@/components/widgets/widget-layout-editor";
import { NotificationPreferences } from "./notification-preferences";
import type { JournalSettings } from "./types";

export function SettingsDialog({
  settings,
  online,
  onChange,
  onClose,
  onSave,
  onSignOut,
}: {
  settings: JournalSettings;
  online: boolean;
  onChange: (settings: JournalSettings) => void;
  onClose: () => void;
  onSave: () => void;
  onSignOut: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-title"><div><p className="eyebrow">PREFERENCES</p><h2 id="settings-title">Journal settings</h2></div><button type="button" onClick={onClose} aria-label="Close settings">×</button></div>
      <label>Save format<small>Tokens: YYYY, MM, MMMM, DD, dddd. Existing files stay where they are.</small><input value={settings.saveFormat} onChange={(event) => onChange({ ...settings, saveFormat: event.target.value })} /></label>
      <label>New entry template<small>Use any Markdown you want as a starting point.</small><textarea value={settings.template} onChange={(event) => onChange({ ...settings, template: event.target.value })} /></label>
      <WidgetLayoutEditor layout={settings.widgetLayout} onChange={(widgetLayout) => onChange({ ...settings, widgetLayout })} />
      <label className="toggle-setting"><input type="checkbox" checked={settings.autoSave} onChange={(event) => onChange({ ...settings, autoSave: event.target.checked })} /><span><b>Automatically save entries</b><small>Save after you pause typing. You can always save immediately with Ctrl+S or Cmd+S.</small></span></label>
      <label className="toggle-setting"><input type="checkbox" checked={settings.autoLocation} onChange={(event) => onChange({ ...settings, autoLocation: event.target.checked })} /><span><b>Add location to new entries</b><small>When you begin writing on an empty day, request your location and add the nearest city, state, and country to its metadata.</small></span></label>
      <label className="toggle-setting"><input type="checkbox" checked={settings.vimMode} onChange={(event) => onChange({ ...settings, vimMode: event.target.checked })} /><span><b>Vim keybindings</b><small>Enable Normal, Insert, and Visual modes in the Live Preview editor on desktop. Mobile always uses standard editing.</small></span></label>
      <NotificationPreferences settings={settings} onChange={onChange} />
      <div className="settings-actions"><button className="text-button" type="button" onClick={onSignOut}>Sign out</button><button className="save-button" type="button" onClick={onSave} disabled={!online}>Save settings</button></div>
    </section>
  </div>;
}
