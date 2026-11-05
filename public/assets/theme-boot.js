// Applies the saved theme before the first paint (loaded synchronously in <head>).
(function () {
  var pref = localStorage.getItem('adbmime.theme') || 'system';
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
})();
