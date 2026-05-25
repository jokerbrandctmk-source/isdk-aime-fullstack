import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBevbHSJFvKU82L0lFsq4700fnx76z4QOw",
  authDomain: "isdk-anime.firebaseapp.com",
  projectId: "isdk-anime",
  storageBucket: "isdk-anime.firebasestorage.app",
  messagingSenderId: "934467950439",
  appId: "1:934467950439:web:d166107c69eac7af2fc1c2"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);