// Auth component JS: i18n + toggle sign in / sign up animations
(function () {
  // support both standalone and inline embedded IDs
  const container = document.getElementById('authContainer') || document.getElementById('authContainerInline');
  const switchBtn = document.getElementById('switchToSignUp') || document.getElementById('switchToSignUpInline');
  const mainAction = document.getElementById('mainAction') || document.getElementById('mainActionInline');
  const formTitle = document.querySelector('.form-title');
  const welcome = document.querySelector('.welcome');
  const form = document.getElementById('authForm') || document.getElementById('authFormInline');
  const message = document.getElementById('authMessage') || document.getElementById('authMessageInline');

  function translate(key, fallback) {
    return typeof window.t === 'function' ? (window.t(key) || fallback) : fallback;
  }

  function setMessage(text, type = '') {
    if (!message) return;
    message.textContent = text || '';
    message.className = `auth-message${type ? ` ${type}` : ''}`;
  }

  function setLoading(isLoading) {
    if (container) container.classList.toggle('is-loading', isLoading);
    if (form) {
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.setAttribute('aria-busy', String(isLoading));
    }
  }

  function updateAuthModeTexts(mode) {
    if (welcome) {
      welcome.dataset.i18n = mode === 'signup' ? 'welcome_signup' : 'welcome_back';
    }
    if (formTitle) {
      formTitle.dataset.i18n = mode === 'signup' ? 'signup_title' : 'signin_title';
    }
    if (mainAction) {
      mainAction.dataset.i18n = mode === 'signup' ? 'signup_btn' : 'signin_btn';
    }
    const password = document.getElementById('password') || document.getElementById('passwordInline');
    if (password) password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    if (switchBtn) {
      // show appropriate switch text: when in signup mode offer link to sign-in
      switchBtn.dataset.i18n = mode === 'signup' ? 'already_have_account' : 'create_account';
    }
    const name = document.getElementById('name') || document.getElementById('nameInline');
    if (name) name.required = mode === 'signup';
  }

  function applyTranslations() {
    if (container && (container.classList.contains('sign-up-mode') || container.classList.contains('sign-up-mode-mobile'))) {
      updateAuthModeTexts('signup');
    } else {
      updateAuthModeTexts('signin');
    }
    if (typeof window.applyTranslations === 'function') {
      window.applyTranslations();
    }
  }

  function enterSignUpMode() {
    if (!container) return;
    // On small screens avoid the big translate animations that break layout
    if (window.innerWidth && window.innerWidth <= 880) {
      container.classList.add('sign-up-mode-mobile');
      container.classList.remove('sign-up-mode');
    } else {
      container.classList.add('sign-up-mode');
      container.classList.remove('sign-up-mode-mobile');
    }
    updateAuthModeTexts('signup');
    fadePanels(() => {
      if (typeof window.applyTranslations === 'function') window.applyTranslations();
    });
  }

  function exitSignUpMode() {
    if (!container) return;
    container.classList.remove('sign-up-mode');
    container.classList.remove('sign-up-mode-mobile');
    updateAuthModeTexts('signin');
    fadePanels(() => {
      if (typeof window.applyTranslations === 'function') window.applyTranslations();
    });
  }

  function fadePanels(callback) {
    const left = document.getElementById('leftPanel') || document.getElementById('leftPanelInline');
    const right = document.getElementById('rightPanel') || document.getElementById('rightPanelInline');
    if (!left || !right) {
      if (typeof callback === 'function') callback();
      return;
    }
    left.style.transition = 'opacity 0.28s ease';
    right.style.transition = 'opacity 0.28s ease';
    left.style.opacity = '0.4';
    right.style.opacity = '0.4';
    setTimeout(() => {
      if (typeof callback === 'function') callback();
      left.style.opacity = '1';
      right.style.opacity = '1';
    }, 320);
  }

  function getSocialProvider(name) {
    const authNamespace = window.firebase && window.firebase.auth ? window.firebase.auth : null;
    if (!authNamespace || !name) return null;
    // Only support Google in this deployment
    if (String(name).toLowerCase() === 'google') return new authNamespace.GoogleAuthProvider();
    return null;
  }

  async function handleSocialLogin(event) {
    event.preventDefault();
    const providerName = event.currentTarget?.dataset?.provider;
    const translate = typeof window.t === 'function' ? window.t : (key) => key;
    const fbAuth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
    const provider = getSocialProvider(providerName);
    if (!fbAuth || !provider) {
      const msg = translate('err_social_provider') || 'Unsupported social login provider';
      setMessage(msg, 'error');
      return;
    }
    setMessage(translate('auth_loading', 'Connexion en cours...'), 'loading');
    setLoading(true);
    try {
      // Try popup first, fallback to redirect if popup is blocked/unavailable
      try {
        await fbAuth.signInWithPopup(provider);
      } catch (popupErr) {
        // If popup not supported in this environment, attempt redirect
        const code = popupErr && popupErr.code ? popupErr.code : '';
        if (code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user') {
          try {
            await fbAuth.signInWithRedirect(provider);
            return; // redirect will continue the flow
          } catch (redirErr) {
            throw redirErr || popupErr;
          }
        }
        throw popupErr;
      }
      const currentEmail = fbAuth.currentUser?.email;
      if (typeof window.updateAuth === 'function') window.updateAuth();
      let isAdmin = (typeof window.isOwnerEmail === 'function' && window.isOwnerEmail(currentEmail)) ||
        (typeof window.isCurrentUserAdmin === 'function' && window.isCurrentUserAdmin());
      if (!isAdmin && typeof window.syncAdminRole === 'function' && fbAuth.currentUser) {
        try {
          isAdmin = await window.syncAdminRole(fbAuth.currentUser);
        } catch (syncErr) {
          console.warn('syncAdminRole failed after social login:', syncErr);
        }
      }
      if (isAdmin && typeof window.showAdminPage === 'function') {
        try {
          const maybePromise = window.showAdminPage();
          if (maybePromise && typeof maybePromise.then === 'function') await maybePromise;
        } catch (e) {
          console.warn('showAdminPage failed:', e);
          if (typeof window.showPage === 'function') window.showPage('admin');
        }
      } else if (typeof window.showPage === 'function') {
        window.showPage('account');
      }
      if (typeof window.showToast === 'function') {
        window.showToast(translate('social_login_success').replace('%s', providerName || '').trim());
      }
      setMessage(translate('auth_success', 'Connexion réussie.'), 'success');
    } catch (err) {
      console.error('Social login failed', err);
      const message = err?.message || translate('err_social_login_failed') || 'Social login failed';
      setMessage(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function init() {
    applyTranslations();
    // Bind auth component and navbar language toggles (avoid inline onclick issues)
    const bindLangEl = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.removeAttribute && el.removeAttribute('onclick');
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.toggleLang === 'function') {
          window.toggleLang();
          if (typeof window.applyTranslations === 'function') window.applyTranslations();
        }
      });
    };
    bindLangEl('langToggle');
    bindLangEl('langBtn');
    if (switchBtn) switchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (container.classList.contains('sign-up-mode') || container.classList.contains('sign-up-mode-mobile')) exitSignUpMode(); else enterSignUpMode();
    });

    const socialButtons = document.querySelectorAll('.social-btn');
    socialButtons.forEach((btn) => btn.addEventListener('click', handleSocialLogin));

    // toggle by clicking primary action when in sign-up mode -> submit
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (container?.classList.contains('is-loading')) return;
        const nameEl = document.getElementById('name') || document.getElementById('nameInline');
        const emailEl = document.getElementById('email') || document.getElementById('emailInline');
        const passEl = document.getElementById('password') || document.getElementById('passwordInline') || document.getElementById('regPass');
        const name = nameEl ? nameEl.value.trim() : '';
        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';

        const fbAuth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
        setMessage(translate('auth_loading', 'Connexion en cours...'), 'loading');
        setLoading(true);
        try {
          if (fbAuth) {
            if (container.classList.contains('sign-up-mode') || container.classList.contains('sign-up-mode-mobile')) {
              const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
              try { if (name && cred.user && cred.user.updateProfile) await cred.user.updateProfile({ displayName: name }); } catch (e) { console.warn('profile update failed', e); }
              try { if (cred.user && cred.user.sendEmailVerification) await cred.user.sendEmailVerification(); } catch (e) { console.warn('sendEmailVerification failed', e); }
              setMessage(translate('signup_success', 'Compte créé. Vérifiez votre e-mail.'), 'success');
            } else {
              await fbAuth.signInWithEmailAndPassword(email, password);
              setMessage(translate('auth_success', 'Connexion réussie.'), 'success');
            }
            if (typeof window.updateAuth === 'function') window.updateAuth();
            const currentEmail = fbAuth.currentUser?.email;
            let isAdmin = (typeof window.isOwnerEmail === 'function' && window.isOwnerEmail(currentEmail)) ||
              (typeof window.isCurrentUserAdmin === 'function' && window.isCurrentUserAdmin());
            if (!isAdmin && typeof window.syncAdminRole === 'function' && fbAuth.currentUser) {
              try { isAdmin = await window.syncAdminRole(fbAuth.currentUser); } catch (syncErr) { console.warn('syncAdminRole failed after login:', syncErr); }
            }
            if (isAdmin && typeof window.showAdminPage === 'function') {
              try {
                const maybePromise = window.showAdminPage();
                if (maybePromise && typeof maybePromise.then === 'function') await maybePromise;
              } catch (e) {
                console.warn('showAdminPage failed:', e);
                if (typeof window.showPage === 'function') window.showPage('admin');
              }
            } else if (typeof window.showPage === 'function') {
              window.showPage('account');
            }
          } else {
            setMessage(translate('auth_unavailable', 'Le service de connexion est momentanément indisponible.'), 'error');
          }
        } catch (err) {
          console.error(err);
          const code = err?.code || '';
          const key = code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
            ? 'err_wrong_creds' : code === 'auth/email-already-in-use' ? 'err_email_taken' : '';
          setMessage(key ? translate(key, err.message) : (err?.message || translate('auth_failed', 'Échec de l’authentification.')), 'error');
        } finally {
          setLoading(false);
        }
      });
    }

    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const field = document.getElementById(button.dataset.passwordToggle);
        if (!field) return;
        const visible = field.type === 'password';
        field.type = visible ? 'text' : 'password';
        button.textContent = '';
        button.classList.toggle('is-visible', visible);
        button.setAttribute('aria-label', visible ? translate('hide_password', 'Masquer le mot de passe') : translate('show_password', 'Afficher le mot de passe'));
      });
    });

    document.querySelectorAll('.forgot-password').forEach((button) => {
      button.addEventListener('click', async () => {
        const emailEl = document.getElementById('email') || document.getElementById('emailInline');
        const email = emailEl?.value.trim() || '';
        const fbAuth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
        if (!email || !emailEl.checkValidity()) {
          setMessage(translate('forgot_email_required', 'Saisissez une adresse e-mail valide.'), 'error');
          emailEl?.focus();
          return;
        }
        if (!fbAuth) {
          setMessage(translate('auth_unavailable', 'Le service de connexion est momentanément indisponible.'), 'error');
          return;
        }
        setLoading(true);
        setMessage(translate('auth_loading', 'Envoi en cours...'), 'loading');
        try {
          await fbAuth.sendPasswordResetEmail(email);
          setMessage(translate('reset_sent', 'Un lien de réinitialisation a été envoyé à votre adresse e-mail.'), 'success');
        } catch (err) {
          setMessage(translate('reset_failed', 'Impossible d’envoyer le lien de réinitialisation.'), 'error');
        } finally {
          setLoading(false);
        }
      });
    });

    // small hover effect for socials: done via CSS
  }

  // Wait DOM
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
