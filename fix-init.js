// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION SCRIPT — Démarrage du site
// ═══════════════════════════════════════════════════════════════════════════

async function initializeApp() {
  console.log('Initializing Je Suis Beatz...');
  
  try {
    // 1. Attendre que Firebase soit initialisé
    if (typeof firebase === 'undefined' || !window.db) {
      console.warn('Waiting for Firebase to initialize...');
      return setTimeout(initializeApp, 500);
    }
    
    // 2. Initialiser l'authentification
    auth.onAuthStateChanged((user) => {
      if (user) {
        console.log('User logged in:', user.email);
        currentUser = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0],
          role: 'user'
        };
        sessionStorage.setItem('jsb_user2', JSON.stringify(currentUser));
        updateAuth();
      } else {
        console.log('No user logged in');
        currentUser = null;
        sessionStorage.removeItem('jsb_user2');
        updateAuth();
      }
    });
    
    // 3. Charger les beats depuis Firestore
    console.log('Loading beats from Firestore...');
    await loadBeatsFromFirestore();
    
    // 4. Initialiser les taux de change
    console.log('Initializing currency rates...');
    initCurrencyRateUpdater();
    
    // 5. Afficher la page d'accueil
    console.log('Showing home page...');
    showPage('home');
    
    // 6. Initialiser les traductions
    console.log('Initializing translations...');
    setTimeout(() => {
      applyTranslations();
    }, 300);
    
    console.log('Je Suis Beatz initialized successfully! ✓');
    
  } catch (error) {
    console.error('Error during initialization:', error);
    // Afficher un message d'erreur
    showToast('⚠ Erreur d\'initialisation');
  }
}

// Lancer l'initialisation quand le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM est déjà prêt
  initializeApp();
}
