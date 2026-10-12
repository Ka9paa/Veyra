export type HotkeyAction="duplicate"|"wrap-frame"|"auto-layout"|"align-left"|"align-center"|"distribute"|"componentize"|"toggle-responsive";
const map:Record<string,HotkeyAction>={"cmd+d":"duplicate","ctrl+d":"duplicate","shift+a":"auto-layout","cmd+alt+g":"wrap-frame","ctrl+alt+g":"wrap-frame"};
export function resolveHotkey(hotkey?:string):HotkeyAction|null{return hotkey?map[hotkey.toLowerCase()]??null:null}
