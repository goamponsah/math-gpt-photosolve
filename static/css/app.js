/*
  app.js
  --------
  This file contains all of the client-side logic for the Math GPT
  photosolver.  The entire application is implemented in the browser
  using JavaScript, so there is no server-side component required.  A
  simple localStorage-based user store tracks registered users, their
  subscription status and free‑trial usage.  Paystack's inline checkout
  flow is used to handle subscription payments and updates the stored
  account state upon completion.  Tesseract.js and Nerdamer are
  leveraged to perform OCR on uploaded images and solve the resulting
  equations directly in the browser.

  NOTE: For production use you should connect to a backend service to
  securely manage users, verify payments and protect premium content.
*/

(() => {
  'use strict';

  /**
   * Configuration constants.  Replace the placeholders below with your
   * actual Paystack public key and (optionally) plan codes.  Prices are
   * expressed in the smallest currency unit (for Ghana this is pesewas).  A
   * value of 10000 corresponds to 100.00 GHS.
   */
  const PAYSTACK_PUBLIC_KEY = 'pk_test_your_public_key_here';
  const MONTHLY_PLAN_CODE = ''; // e.g. 'PLN_xxxxxxxxx'
  const ANNUAL_PLAN_CODE = '';  // e.g. 'PLN_yyyyyyyyy'
  const CURRENCY = 'GHS';
  const MONTHLY_PRICE = 10000; // 100.00 GHS in pesewas
  const ANNUAL_PRICE  = 100000; // 1 000.00 GHS in pesewas
  const FREE_TRIAL_LIMIT = 3;

  /**
   * A helper for hashing passwords.  In a production application you
   * should never store plain text passwords and instead rely on a
   * server‑side authentication service.  Here we use the Web Crypto
   * API to compute a SHA‑256 digest of the provided string.  The
   * resulting hex representation is returned as a promise.
   *
   * @param {string} str
   * @returns {Promise<string>}
   */
  async function sha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Retrieve the list of users from localStorage.  If no users have
   * registered yet an empty array is returned.
   *
   * @returns {Array<Object>}
   */
  function getUsers() {
    const raw = localStorage.getItem('mathgpt_users');
    try {
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('Failed to parse users', err);
      return [];
    }
  }

  /**
   * Persist the provided users array into localStorage.
   *
   * @param {Array<Object>} users
   */
  function setUsers(users) {
    localStorage.setItem('mathgpt_users', JSON.stringify(users));
  }

  /**
   * Attempt to find a user by email.  The search is case-insensitive.
   *
   * @param {string} email
   * @returns {Object|null}
   */
  function findUser(email) {
    const users = getUsers();
    return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  }

  /**
   * Save updates for a specific user.  If the user does not yet exist in
   * the user list they will be added.
   *
   * @param {Object} user
   */
  function saveUser(user) {
    const users = getUsers();
    const idx = users.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (idx >= 0) {
      users[idx] = user;
    } else {
      users.push(user);
    }
    setUsers(users);
  }

  /**
   * Set the currently logged in user.  This stores only the user's
   * email address; the full user record is loaded from the users list
   * when needed.
   *
   * @param {string|null} email
   */
  function setCurrentUser(email) {
    if (email) {
      localStorage.setItem('mathgpt_current_user', email);
    } else {
      localStorage.removeItem('mathgpt_current_user');
    }
  }

  /**
   * Retrieve the currently logged in user.  If no user is logged in
   * then null is returned.
   *
   * @returns {Object|null}
   */
  function getCurrentUser() {
    const email = localStorage.getItem('mathgpt_current_user');
    if (!email) return null;
    return findUser(email);
  }

  /**
   * Load the year into the footer automatically.
   */
  function loadYear() {
    const yearSpan = document.getElementById('year-span');
    if (yearSpan) {
      yearSpan.textContent = new Date().getFullYear();
    }
  }

  /**
   * Show or hide sections and update the navigation based on the
   * logged‑in user's subscription status.  If no user is logged in
   * then the authentication section is displayed.
   */
  function render() {
    const authSection = document.getElementById('auth-section');
    const pricingSection = document.getElementById('pricing-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const navWelcome = document.getElementById('nav-welcome');
    const navLogout = document.getElementById('nav-logout');
    const navDashboard = document.getElementById('nav-dashboard');
    const navPricing = document.getElementById('nav-pricing');

    const user = getCurrentUser();
    if (!user) {
      // No user logged in; show auth forms
      authSection.style.display = 'block';
      pricingSection.style.display = 'none';
      dashboardSection.style.display = 'none';
      navWelcome.style.display = 'none';
      navLogout.style.display = 'none';
      navDashboard.parentElement.style.display = 'none';
      navPricing.parentElement.style.display = 'none';
      return;
    }

    // User logged in – show nav options
    navWelcome.style.display = 'block';
    navWelcome.innerHTML = `<a class="nav-link disabled" href="#">Hello, ${user.name.split(' ')[0]}</a>`;
    navLogout.style.display = 'block';
    navDashboard.parentElement.style.display = '';
    navPricing.parentElement.style.display = '';

    // Determine view based on subscription/free trial status
    const now = new Date();
    let isSubscribed = false;
    if (user.subscription && user.subscription !== 'none' && user.subscriptionStart) {
      const start = new Date(user.subscriptionStart);
      if (user.subscription === 'monthly') {
        // monthly subscription lasts 1 month
        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);
        isSubscribed = now < end;
      } else if (user.subscription === 'annual') {
        // annual subscription lasts 12 months
        const end = new Date(start);
        end.setFullYear(end.getFullYear() + 1);
        isSubscribed = now < end;
      }
    }
    const freeUsesLeft = Math.max(0, FREE_TRIAL_LIMIT - (user.freeTrialUsed || 0));
    if (isSubscribed || freeUsesLeft > 0) {
      // show dashboard
      authSection.style.display = 'none';
      pricingSection.style.display = 'none';
      dashboardSection.style.display = 'block';
      navDashboard.classList.add('active');
      navPricing.classList.remove('active');
      updateSubscriptionPrices();
    } else {
      // show pricing
      authSection.style.display = 'none';
      pricingSection.style.display = 'block';
      dashboardSection.style.display = 'none';
      navDashboard.classList.remove('active');
      navPricing.classList.add('active');
      updateSubscriptionPrices();
    }
  }

  /**
   * Update the displayed prices for monthly and annual subscriptions on the
   * pricing cards.  This helper formats the pesewa amounts into GHS
   * strings with two decimal places.
   */
  function updateSubscriptionPrices() {
    const formatCurrency = (value) => {
      const ghs = value / 100;
      return `GHS ${ghs.toFixed(2)}`;
    };
    const monthlyPriceEl = document.getElementById('monthly-price');
    const annualPriceEl  = document.getElementById('annual-price');
    if (monthlyPriceEl) monthlyPriceEl.textContent = formatCurrency(MONTHLY_PRICE);
    if (annualPriceEl)  annualPriceEl.textContent  = formatCurrency(ANNUAL_PRICE);
  }

  /**
   * Initialize event listeners for forms, buttons and navigation.
   */
  function initEventListeners() {
    // Registration form submission
    const registerForm = document.getElementById('register-form');
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      const errorEl = document.getElementById('register-error');

      if (!name || !email || !password) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'All fields are required.';
        return;
      }
      if (findUser(email)) {
          errorEl.style.display = 'block';
          errorEl.textContent = 'An account with that email already exists.';
          return;
      }
      // Hash the password before saving
      const hashed = await sha256(password);
      const user = {
        name,
        email,
        password: hashed,
        subscription: 'none',
        subscriptionStart: '',
        subscriptionReference: '',
        freeTrialUsed: 0,
      };
      saveUser(user);
      setCurrentUser(email);
      // reset form fields
      registerForm.reset();
      errorEl.style.display = 'none';
      render();
    });

    // Login form submission
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      const user = findUser(email);
      if (!user) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'User not found.';
        return;
      }
      const hashed = await sha256(password);
      if (hashed !== user.password) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'Incorrect password.';
        return;
      }
      setCurrentUser(user.email);
      loginForm.reset();
      errorEl.style.display = 'none';
      render();
    });

    // Logout link
    const logoutLink = document.getElementById('nav-logout');
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      setCurrentUser(null);
      render();
    });

    // Navigation links
    document.getElementById('nav-dashboard').addEventListener('click', (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if (!user) return;
      document.getElementById('pricing-section').style.display = 'none';
      document.getElementById('dashboard-section').style.display = 'block';
      document.getElementById('nav-dashboard').classList.add('active');
      document.getElementById('nav-pricing').classList.remove('active');
    });
    document.getElementById('nav-pricing').addEventListener('click', (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if (!user) return;
      document.getElementById('pricing-section').style.display = 'block';
      document.getElementById('dashboard-section').style.display = 'none';
      document.getElementById('nav-dashboard').classList.remove('active');
      document.getElementById('nav-pricing').classList.add('active');
      updateSubscriptionPrices();
    });

    // Back button on pricing page
    document.getElementById('back-to-dashboard').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('pricing-section').style.display = 'none';
      document.getElementById('dashboard-section').style.display = 'block';
      document.getElementById('nav-dashboard').classList.add('active');
      document.getElementById('nav-pricing').classList.remove('active');
    });

    // Free trial button
    document.getElementById('free-trial-btn').addEventListener('click', (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if (!user) return;
      const freeUsed = user.freeTrialUsed || 0;
      if (freeUsed >= FREE_TRIAL_LIMIT) {
        alert('You have exhausted your free trial. Please subscribe to continue using Math GPT.');
        return;
      }
      // Take the user to the dashboard
      document.getElementById('pricing-section').style.display = 'none';
      document.getElementById('dashboard-section').style.display = 'block';
      document.getElementById('nav-dashboard').classList.add('active');
      document.getElementById('nav-pricing').classList.remove('active');
    });

    // Monthly subscription button
    document.getElementById('monthly-btn').addEventListener('click', (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if (!user) return;
      initiatePayment({ planType: 'monthly', price: MONTHLY_PRICE, planCode: MONTHLY_PLAN_CODE });
    });
    // Annual subscription button
    document.getElementById('annual-btn').addEventListener('click', (e) => {
      e.preventDefault();
      const user = getCurrentUser();
      if (!user) return;
      initiatePayment({ planType: 'annual', price: ANNUAL_PRICE, planCode: ANNUAL_PLAN_CODE });
    });

    // File input change
    const uploadInput = document.getElementById('upload-input');
    uploadInput.addEventListener('change', () => {
      const file = uploadInput.files[0];
      const solveBtn = document.getElementById('solve-btn');
      if (file) {
        solveBtn.disabled = false;
      } else {
        solveBtn.disabled = true;
      }
    });
    // Solve button click
    document.getElementById('solve-btn').addEventListener('click', async () => {
      const user = getCurrentUser();
      if (!user) return;
      const freeUsed = user.freeTrialUsed || 0;
      const now = new Date();
      let isSubscribed = false;
      if (user.subscription && user.subscription !== 'none' && user.subscriptionStart) {
        const start = new Date(user.subscriptionStart);
        if (user.subscription === 'monthly') {
          const end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          isSubscribed = now < end;
        } else if (user.subscription === 'annual') {
          const end = new Date(start);
          end.setFullYear(end.getFullYear() + 1);
          isSubscribed = now < end;
        }
      }
      if (!isSubscribed && freeUsed >= FREE_TRIAL_LIMIT) {
        alert('You have exhausted your free trial. Please subscribe to continue using Math GPT.');
        // redirect to pricing
        document.getElementById('pricing-section').style.display = 'block';
        document.getElementById('dashboard-section').style.display = 'none';
        document.getElementById('nav-dashboard').classList.remove('active');
        document.getElementById('nav-pricing').classList.add('active');
        return;
      }
      const file = uploadInput.files[0];
      if (!file) return;
      solveImage(file);
    });
  }

  /**
   * Kick off a Paystack payment flow.  This helper reads the current
   * user's details, sets up the configuration and uses the inline
   * interface to handle the transaction.  On successful payment the
   * subscription fields on the user record are updated and the UI is
   * refreshed.
   *
   * @param {{planType: string, price: number, planCode: string}} config
   */
  function initiatePayment(config) {
    const user = getCurrentUser();
    if (!user) return;
    if (!PAYSTACK_PUBLIC_KEY || PAYSTACK_PUBLIC_KEY.indexOf('pk_test') === -1 && PAYSTACK_PUBLIC_KEY.indexOf('pk_live') === -1) {
      alert('Please set your Paystack public key in static/js/app.js before initiating payments.');
      return;
    }
    const { planType, price, planCode } = config;
    const paystackConfig = {
      key: PAYSTACK_PUBLIC_KEY,
      email: user.email,
      amount: price, // amount is already in pesewas
      currency: CURRENCY,
      callback: function (response) {
        // On successful payment, update user subscription
        user.subscription = planType;
        user.subscriptionStart = new Date().toISOString();
        user.subscriptionReference = response.reference;
        saveUser(user);
        alert('Payment complete! You are now subscribed to the ' + planType + ' plan.');
        render();
      },
      onClose: function () {
        alert('Payment window closed.');
      },
    };
    if (planCode) {
      paystackConfig.plan = planCode;
    }
    const handler = PaystackPop.setup(paystackConfig);
    handler.openIframe();
  }

  /**
   * Perform OCR on the provided image using Tesseract.js and then
   * attempt to solve any equation contained in the recognized text
   * using Nerdamer.  Progress is reported via the progress bar.  On
   * completion the result is displayed to the user and free trial
   * counters are updated accordingly.
   *
   * @param {File} file
   */
  async function solveImage(file) {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const resultEl = document.getElementById('result');
    // Reset progress and result
    progressBar.style.width = '0%';
    progressContainer.style.display = 'block';
    resultEl.style.display = 'none';
    resultEl.classList.remove('alert-success', 'alert-danger', 'alert-warning');

    try {
      const worker = Tesseract.createWorker();
      await worker.load();
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      // Recognize text with progress updates
      const { data } = await worker.recognize(file, {}, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round(m.progress * 100);
            progressBar.style.width = `${pct}%`;
          }
        },
      });
      await worker.terminate();
      // The raw OCR output may contain multiple lines; pick the first
      const text = data && data.text ? data.text.trim() : '';
      if (!text) {
        throw new Error('No text could be recognized in the image.');
      }
      // Attempt to extract an equation.  We assume the first line contains
      // the equation.  Remove whitespace and newline characters.
      const firstLine = text.split(/\n|\r/)[0].replace(/\s+/g, '');
      // Identify the variable to solve for; default to 'x' if none found
      let variable = 'x';
      const match = firstLine.match(/[a-zA-Z]/);
      if (match) variable = match[0];
      // Solve using Nerdamer.  If there is an equals sign treat it as
      // equation, otherwise just evaluate it as an expression equal to 0.
      let solutions;
      try {
        if (firstLine.includes('=')) {
          solutions = nerdamer.solve(firstLine, variable);
        } else {
          // expression = 0
          solutions = nerdamer.solve(firstLine + '=0', variable);
        }
      } catch (err) {
        console.warn('Nerdamer could not parse equation', err);
        throw new Error('Unable to parse and solve the recognized equation.');
      }
      let solutionText;
      if (solutions && typeof solutions.toString === 'function') {
        solutionText = solutions.toString();
      } else {
        solutionText = JSON.stringify(solutions);
      }
      resultEl.classList.add('alert-success');
      resultEl.textContent = `OCR: ${firstLine}\nSolution (${variable}): ${solutionText}`;
      resultEl.style.display = 'block';
      // Update free trial usage if user is not subscribed
      const user = getCurrentUser();
      const now = new Date();
      let isSubscribed = false;
      if (user.subscription && user.subscription !== 'none' && user.subscriptionStart) {
        const start = new Date(user.subscriptionStart);
        if (user.subscription === 'monthly') {
          const end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          isSubscribed = now < end;
        } else if (user.subscription === 'annual') {
          const end = new Date(start);
          end.setFullYear(end.getFullYear() + 1);
          isSubscribed = now < end;
        }
      }
      if (!isSubscribed) {
        user.freeTrialUsed = (user.freeTrialUsed || 0) + 1;
        saveUser(user);
      }
    } catch (err) {
      console.error(err);
      resultEl.classList.add('alert-danger');
      resultEl.textContent = `Error: ${err.message || err}`;
      resultEl.style.display = 'block';
    } finally {
      progressContainer.style.display = 'none';
    }
  }

  // Initialize the application once the DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    loadYear();
    initEventListeners();
    render();
  });
})();