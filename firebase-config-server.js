const { initializeApp } = require("firebase/app") 
const { getFirestore }  = require('firebase/firestore') 

const firebaseConfig = {
  apiKey: "AIzaSyCZSJj5QTqPmh8W5Ra4hrFhiiZD9ed39As",
  authDomain: "phillip-e1278.firebaseapp.com",
  projectId: "phillip-e1278",
  storageBucket: "phillip-e1278.appspot.com",
  messagingSenderId: "395529469083",
  appId: "1:395529469083:web:b5716e84d85c5ef5005a3e"
};

const app = initializeApp(firebaseConfig);

module.exports = {
   db : getFirestore(app)
}