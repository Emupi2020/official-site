import { api, safeGet, $ } from './common.mjs';

function showStatus(id, text, error = false) {
  const status = $(id);
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle('danger', error);
}

const form = $('bug-report-form');
if (form) {
  const input = $('bug-report-message');
  const send = form.querySelector('button');
  let sending = false;
  const updateButton = () => { send.disabled = sending || !input.value.trim(); };
  input.addEventListener('input', updateButton);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (sending || !message || $('request-screen').hidden) return;
    const name = safeGet('emupi-request-name') || $('name').value;
    if (!name.trim()) {
      showStatus('bug-report-status', 'Pocochaの名前を設定してください。', true);
      return;
    }
    sending = true;
    input.readOnly = true;
    updateButton();
    showStatus('bug-report-status', '');
    try {
      await api('/api/bug-reports', {method:'POST', data:{name, message}});
      input.value = '';
      showStatus('bug-report-status', '送信しました。');
    } catch (error) {
      showStatus('bug-report-status', error.message, true);
    } finally {
      sending = false;
      input.readOnly = false;
      updateButton();
    }
  });
  updateButton();
}

const section = $('admin-bug-reports');
if (section) {
  const list = $('bug-report-list');
  const refresh = $('refresh-bug-reports');
  const more = $('more-bug-reports');
  const format = new Intl.DateTimeFormat('ja-JP', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Tokyo'});
  let cursor = null;
  let loading = false;

  async function loadReports(before = null) {
    if (loading) return;
    loading = true;
    refresh.disabled = more.disabled = true;
    showStatus('admin-bug-report-status', '読み込み中…');
    try {
      const path = '/api/admin/bug-reports';
      const { reports, next } = await api(before === null ? path : path + '?before=' + before);
      if (before === null) list.replaceChildren();
      for (const { name, message, createdAt } of reports) {
        const date = new Date(createdAt);
        const item = document.createElement('li');
        const time = document.createElement('time');
        const text = document.createElement('p');
        time.dateTime = date.toISOString();
        time.textContent = format.format(date);
        text.textContent = message;
        const author = document.createElement('strong');
        author.textContent = name;
        const meta = document.createElement('div');
        meta.className = 'bug-report-meta';
        meta.append(author, time);
        item.append(meta, text);
        list.append(item);
      }
      cursor = next;
      more.hidden = cursor === null;
      showStatus('admin-bug-report-status', list.children.length ? '' : 'まだバグ報告はありません。');
    } catch (error) {
      showStatus('admin-bug-report-status', error.message, true);
    } finally {
      loading = false;
      refresh.disabled = more.disabled = false;
    }
  }

  if (new URLSearchParams(location.search).get('view') === 'reports') {
    if ($('dashboard').hidden) document.addEventListener('admin-ready', () => loadReports(), {once:true});
    else loadReports();
  }
  refresh.onclick = () => loadReports();
  more.onclick = () => loadReports(cursor);
}
