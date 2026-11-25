const requestPage = document.querySelector('.request-page');
const siteFooter = document.querySelector('.site-footer');
const menus = [...document.querySelectorAll('.listener-nav .menu-toggle')].map(toggle => ({
 toggle,
 panel: document.getElementById(toggle.getAttribute('aria-controls')),
}));
let activeMenu = null;

function setActiveMenu(next, restoreFocus = true) {
 const previous = activeMenu;
 activeMenu = next;
 for (const menu of menus) {
  const open = menu === next;
  menu.panel.inert = !open;
  menu.toggle.setAttribute('aria-expanded', String(open));
  menu.toggle.setAttribute('aria-label', menu.panel.getAttribute('aria-label') + (open ? 'を閉じる' : 'を開く'));
 }
 requestPage.inert = Boolean(next);
 siteFooter.inert = Boolean(next);
 if (!next && restoreFocus) previous?.toggle.focus();
}

export function closeMenu() {
 if (activeMenu) setActiveMenu(null);
}

for (const menu of menus) {
 menu.toggle.onclick = () => setActiveMenu(activeMenu === menu ? null : menu);
}
document.addEventListener('keydown', event => {
 if (event.key === 'Escape') closeMenu();
});
window.addEventListener('pagehide', () => {
 if (activeMenu) setActiveMenu(null, false);
});
