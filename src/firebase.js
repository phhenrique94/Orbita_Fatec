const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!admin.apps.length) {
    let credential;

    // 1. Tenta usar o arquivo local primeiro (mais fácil para desenvolvimento na sua máquina)
    const localKeyPath = path.join(__dirname, '../serviceAccountKey.json');
    
    if (fs.existsSync(localKeyPath)) {
        const serviceAccount = require(localKeyPath);
        credential = admin.credential.cert(serviceAccount);
        console.log('✅ Firebase Admin inicializado via serviceAccountKey.json (Modo Local)');
    } 
    // 2. Se não achar o arquivo, tenta pelas variáveis de ambiente (Como vai rodar no Vercel)
    else if (process.env.FIREBASE_PRIVATE_KEY) {
        credential = admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
        console.log('✅ Firebase Admin inicializado via Variáveis de Ambiente (.env / Vercel)');
    } else {
        throw new Error('❌ Credenciais do Firebase Admin não encontradas. Configure o .env ou coloque o arquivo serviceAccountKey.json na raiz.');
    }

    admin.initializeApp({
        credential: credential
    });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
