const $ = id => document.getElementById(id);
const menuToggle = $('request-menu-toggle');
const requestMenu = $('request-menu');
const requestPage = document.querySelector('.request-page');
const siteFooter = document.querySelector('.site-footer');
function setMenuOpen(open) {
 requestMenu.hidden = !open;
 menuToggle.setAttribute('aria-expanded', String(open));
 menuToggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
 requestPage.inert = open;
 siteFooter.inert = open;
 if (!open) menuToggle.focus();
}
menuToggle.onclick = () => setMenuOpen(requestMenu.hidden);
document.addEventListener('keydown', event => {
 if (event.key === 'Escape' && !requestMenu.hidden) setMenuOpen(false);
});
window.addEventListener('pagehide', () => {
 if (!requestMenu.hidden) setMenuOpen(false);
});
