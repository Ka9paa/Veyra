(() => {
  const root = document.querySelector('[data-admin-root]');
  if (!root) return;

  const closeMenus = (except) => {
    document.querySelectorAll('[data-menu].open,.va-plan-picker.open').forEach(el => {
      if (el !== except) el.classList.remove('open');
    });
  };

  document.addEventListener('click', (e) => {
    const menu = e.target.closest('[data-menu]');
    const picker = e.target.closest('[data-plan-picker]');

    if (menu && e.target.closest('[data-menu-trigger]')) {
      const was = menu.classList.contains('open');
      closeMenus(menu);
      menu.classList.toggle('open', !was);
      return;
    }

    if (picker && e.target.closest('[data-plan-trigger]')) {
      const was = picker.classList.contains('open');
      closeMenus(picker);
      picker.classList.toggle('open', !was);
      return;
    }

    const planButton = e.target.closest('[data-plan]');
    if (planButton && picker) {
      const value = planButton.dataset.plan;
      const hidden = picker.closest('form')?.querySelector('[data-plan-value]');
      const current = picker.querySelector('.va-plan-current');
      if (hidden) hidden.value = value;
      picker.dataset.value = value;
      current.innerHTML = `<span class="va-plan-badge ${value}">${value.toUpperCase()}</span><span>⌄</span>`;
      picker.classList.remove('open');
      return;
    }

    closeMenus(null);
  });

  const filterRows = () => {
    const search = (document.getElementById('userSearch')?.value || '').toLowerCase().trim();
    const activePlan = root.dataset.planFilter || 'all';
    const activeStatus = root.dataset.statusFilter || 'all';
    document.querySelectorAll('[data-user-row]').forEach(row => {
      const matchesText = !search || row.dataset.name.includes(search) || row.dataset.email.includes(search) || row.textContent.toLowerCase().includes(search);
      const matchesPlan = activePlan === 'all' || row.dataset.plan === activePlan;
      const matchesStatus = activeStatus === 'all' || row.dataset.status === activeStatus;
      row.hidden = !(matchesText && matchesPlan && matchesStatus);
    });
  };

  document.getElementById('userSearch')?.addEventListener('input', filterRows);

  document.querySelectorAll('[data-plan-filter]').forEach(btn => btn.addEventListener('click', () => {
    root.dataset.planFilter = btn.dataset.planFilter;
    const holder = btn.closest('[data-menu]');
    holder.querySelector('[data-menu-trigger]').innerHTML = `${btn.textContent} <span>⌄</span>`;
    holder.classList.remove('open');
    filterRows();
  }));

  document.querySelectorAll('[data-status-filter]').forEach(btn => btn.addEventListener('click', () => {
    root.dataset.statusFilter = btn.dataset.statusFilter;
    const holder = btn.closest('[data-menu]');
    holder.querySelector('[data-menu-trigger]').innerHTML = `${btn.textContent} <span>⌄</span>`;
    holder.classList.remove('open');
    filterRows();
  }));

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('globalSearch')?.focus();
    }
    if (e.key === 'Escape') closeMenus(null);
  });
})();
