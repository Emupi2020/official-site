const $ = id => document.getElementById(id);
const menuToggle = $('request-menu-toggle');
const requestMenu = $('request-menu');
const requestPage = document.querySelector('.request-page');
const siteFooter = document.querySelector('.site-footer');
function setMenuOpen(open) {
 requestMenu.inert = !open;
 menuToggle.setAttribute('aria-expanded', String(open));
 menuToggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
 requestPage.inert = open;
 siteFooter.inert = open;
 if (!open) menuToggle.focus();
}
menuToggle.onclick = () => setMenuOpen(requestMenu.inert);
document.addEventListener('keydown', event => {
 if (event.key === 'Escape' && !requestMenu.inert) setMenuOpen(false);
});
window.addEventListener('pagehide', () => {
 if (!requestMenu.inert) setMenuOpen(false);
});
