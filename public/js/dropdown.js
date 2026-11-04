// Dropdown with an icon per option (a native <select> cannot show images): used in the settings
// for the language (flags) and the theme (symbols). Keyboard: Enter/Space/↓ open, ↑/↓ move,
// Enter selects, Esc closes.
import { icon } from '/assets/icons.js';
import { esc } from './core.js';

/**
 * `root` gets the button and the list. `options()` returns
 * [{ value, label, sub?, icon: html }] (called at every render, so labels follow the language).
 * Returns { render } to refresh after a language or value change.
 */
export function dropdown(root, { options, value, onChange }) {
  root.classList.add('dd');
  root.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"></button>
    <div class="dd-menu" role="listbox" tabindex="-1" hidden></div>`;
  const btn = root.querySelector('.dd-btn');
  const menu = root.querySelector('.dd-menu');

  const item = (o) => `<span class="dd-ico">${o.icon}</span>
    <span class="dd-text"><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>`;

  function render() {
    const list = options();
    const current = list.find((o) => o.value === value()) ?? list[0];
    btn.innerHTML = `${item(current)}${icon('down')}`;
    menu.innerHTML = list
      .map(
        (o) => `<button type="button" role="option" class="dd-opt" data-v="${esc(o.value)}" aria-selected="${o.value === current.value}">
          ${item(o)}${o.value === current.value ? icon('check') : ''}</button>`,
      )
      .join('');
  }

  const opts = () => [...menu.querySelectorAll('.dd-opt')];
  const isOpen = () => !menu.hidden;

  function open() {
    render();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-selected="true"]') ?? opts()[0])?.focus();
  }

  function close(focusButton = true) {
    if (!isOpen()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  }

  btn.onclick = () => (isOpen() ? close() : open());
  btn.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  };
  menu.onclick = async (e) => {
    const o = e.target.closest('.dd-opt');
    if (!o) return;
    close();
    if (o.dataset.v !== value()) await onChange(o.dataset.v);
    render();
  };
  menu.onkeydown = (e) => {
    const list = opts();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      // Close only the list, not the settings drawer around it.
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };
  document.addEventListener('click', (e) => {
    if (isOpen() && !root.contains(e.target)) close(false);
  });

  render();
  return { render };
}
