// The rich menu: the panel of big buttons under the chat (private chats only;
// LINE doesn't show rich menus in groups). Each button just "types" a message
// for the user, which the bot already understands.
// The picture is assets/richmenu.png (scripts/make-richmenu-image.py), same 3 x 2 grid.

export const RICH_MENU_BUTTONS = [
  "💸 หารบิล", "👀 ใครยังไม่จ่าย", "💰 รับเงิน",
  "😷 ฝุ่น", "☔ อากาศ", "⚙️ ตั้งค่า",
];

export function richMenuDefinition() {
  const W = 2500, H = 1686, cols = 3, rows = 2;
  const xs = [0, 833, 1666, W], ys = [0, 843, H];
  return {
    size: { width: W, height: H },
    selected: true,               // open by default
    name: "khun-chuay-main",
    chatBarText: "เมนู · Menu",   // the tap-to-open bar label (max 14 chars)
    areas: RICH_MENU_BUTTONS.map((label, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      return {
        bounds: { x: xs[c], y: ys[r], width: xs[c + 1] - xs[c], height: ys[r + 1] - ys[r] },
        action: { type: "message", label: label.replace(/^\S+\s/, ""), text: label },
      };
    }),
  };
}
