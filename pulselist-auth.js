const auth = firebase.auth();
const db   = firebase.firestore();

// ── UI helpers ────────────────────────────────────────────────────────────────
const panels     = [...document.querySelectorAll("[data-auth-panel]")];
const tabButtons = [...document.querySelectorAll("[data-auth-tab]")];

function setPanel(name) {
  panels.forEach(p => {
    const active = p.dataset.authPanel === name;
    p.classList.toggle("is-active", active);
    p.hidden = !active;
  });
  tabButtons.forEach(b => b.classList.toggle("is-active", b.dataset.authTab === name));
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

// ── Tab switching ─────────────────────────────────────────────────────────────
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => setPanel(btn.dataset.authTab));
});

document.querySelector("[data-open-reset]")?.addEventListener("click", () => setPanel("reset"));
document.querySelector("[data-back-to-signin]")?.addEventListener("click", () => setPanel("signin"));

// ── Sign up ───────────────────────────────────────────────────────────────────
document.getElementById("signupForm")?.addEventListener("submit", async function(e) {
  e.preventDefault();
  showError("signupError", "");

  const email           = this.email.value.trim();
  const password        = this.password.value;
  const confirmPassword = this.confirmPassword.value;
  const terms           = this.terms.checked;

  if (!email || !password) return showError("signupError", "Please enter your email and password.");
  if (password.length < 6) return showError("signupError", "Password must be at least 6 characters.");
  if (password !== confirmPassword) return showError("signupError", "Passwords do not match.");
  if (!terms) return showError("signupError", "You must agree to the terms to continue.");

  try {
    const invite = await db.collection("invites").doc(email.toLowerCase()).get();
    if (!invite.exists) {
      return showError("signupError", "Account creation is by invitation only. Contact us to request access.");
    }
  } catch (err) {
    console.error("Invite check failed:", err);
    return showError("signupError", "Could not verify your invitation. Please try again.");
  }

  auth.createUserWithEmailAndPassword(email, password)
    .then(() => { window.location.href = "pulselist-app.html"; })
    .catch(err => {
      console.error("Signup error:", err);
      const msgs = {
        "auth/email-already-in-use": "An account with this email already exists. Try signing in.",
        "auth/invalid-email": "That email address doesn't look right.",
        "auth/weak-password": "Password is too weak. Use at least 6 characters."
      };
      showError("signupError", msgs[err.code] || err.message);
    });
});

// ── Sign in ───────────────────────────────────────────────────────────────────
document.getElementById("signinForm")?.addEventListener("submit", function(e) {
  e.preventDefault();
  showError("signinError", "");

  const email    = this.signinEmail.value.trim();
  const password = this.signinPassword.value;

  if (!email || !password) return showError("signinError", "Please enter your email and password.");

  auth.signInWithEmailAndPassword(email, password)
    .then(() => { window.location.href = "pulselist-app.html"; })
    .catch(err => {
      console.error("Signin error:", err);
      const msgs = {
        "auth/invalid-credential": "Incorrect email or password. Please try again.",
        "auth/user-not-found":  "No account found with that email.",
        "auth/wrong-password":  "Incorrect password. Please try again.",
        "auth/invalid-email":   "That email address doesn't look right.",
        "auth/too-many-requests": "Too many attempts. Please wait a moment and try again."
      };
      showError("signinError", msgs[err.code] || err.message);
    });
});

// ── Reset password ────────────────────────────────────────────────────────────
document.getElementById("resetForm")?.addEventListener("submit", function(e) {
  e.preventDefault();
  showError("resetError", "");
  const email = this.resetEmail.value.trim();
  if (!email) return showError("resetError", "Please enter your email address.");

  const actionCodeSettings = { url: window.location.origin + "/pulselist-auth.html" };

  auth.sendPasswordResetEmail(email, actionCodeSettings)
    .then(() => {
      const success = document.querySelector("[data-reset-success]");
      if (success) success.hidden = false;
    })
    .catch(err => {
      console.error("Reset error:", err);
      const msgs = {
        "auth/invalid-email":     "That email address doesn't look right.",
        "auth/too-many-requests": "Too many attempts. Please wait a moment and try again."
      };
      showError("resetError", msgs[err.code] || err.message);
    });
});

// ── Auto-redirect if already signed in ───────────────────────────────────────
auth.onAuthStateChanged(user => {
  if (user) window.location.href = "pulselist-app.html";
});
