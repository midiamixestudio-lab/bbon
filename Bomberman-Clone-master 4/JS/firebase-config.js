
const firebaseConfig = {
  apiKey: "AIzaSyAi5EdTnpPo7Dqio-fxqFKFvwSk2fz7XRY",
  authDomain: "jogosclassico.firebaseapp.com",
  databaseURL: "https://jogosclassico-default-rtdb.firebaseio.com",
  projectId: "jogosclassico",
  storageBucket: "jogosclassico.firebasestorage.app",
  messagingSenderId: "779975210603",
  appId: "1:779975210603:web:5b54b2aef9729feb83e32e"
};

// Inicializa Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Referências
const playersRef = database.ref('players');
const gameStateRef = database.ref('gameState');
const bombsRef = database.ref('bombs');
const enemiesRef = database.ref('enemies');
const mapRef = database.ref('map');
const roomsRef = database.ref('rooms');