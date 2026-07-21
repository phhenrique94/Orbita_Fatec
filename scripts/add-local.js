/**
 * Script utilitário para adicionar um local diretamente no Firestore (sem autenticação).
 * Uso: node scripts/add-local.js
 */
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function main() {
  const novoLocal = {
    nome: 'JBL',
    tipo: 'jbl',
    capacidade: 50,
    createdAt: new Date().toISOString()
  };

  const docRef = db.collection('locais_agenda').doc();
  await docRef.set(novoLocal);
  console.log(`✅ Local "JBL" adicionado com ID: ${docRef.id}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
