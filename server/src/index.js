import admin from 'firebase-admin'
import Queue from 'firebase-queue'
import express from 'express'

const {
  FIREBASE_SERVICE_ACCOUNT_KEY,
  FIREBASE_DATABASE
} = process.env

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(new Buffer(FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString())
  ),
  databaseURL: FIREBASE_DATABASE
})

const AUTH_REF = admin.database().ref('authentication')
const QUEUES_REF = AUTH_REF.child('userWritable')
const NOTES_QUEUE_REF = QUEUES_REF.child('notes-queue')
const USER_PRIVATE_REF = AUTH_REF.child('userReadable')
const PUBLIC_NOTES_REF = AUTH_REF.child('allMembers').child('notes')

const notesQueue = new Queue(NOTES_QUEUE_REF, {sanitize: false}, (data, progress, resolve, reject) => {
  // Read and process task data
  progress(10)

  if (data.action === 'delete') {
    admin.auth().verifyIdToken(data.idToken)
      .then(decodedToken => {
        const uid = decodedToken.uid
        USER_PRIVATE_REF.child(uid).child('notes').child(data.target).remove()
        PUBLIC_NOTES_REF.child(data.language).child(data.target).child('uid').once('value')
          .then(snapshot => {
            if (snapshot.val() === uid) {
              PUBLIC_NOTES_REF.child(data.language).child(data.target).remove()
              NOTES_QUEUE_REF.child(data._id).remove()
              resolve()
            } else {
              NOTES_QUEUE_REF.child(data._id).remove()
              resolve()
            }
          })
      }).catch(() => reject())
  }

  if (data.action === 'edit') {
    admin.auth().verifyIdToken(data.idToken)
      .then(decodedToken => {
        const uid = decodedToken.uid
        USER_PRIVATE_REF.child(uid).child('notes').child(data.note_id).child('note').set(data.data.text)
        USER_PRIVATE_REF.child(uid).child('notes').child(data.note_id).child('edit_date').set(data.data.edit_date)
        PUBLIC_NOTES_REF.child(data.language).child(data.note_id).child('uid').once('value').then(snapshot => {
          if (snapshot.val() === uid) {
            PUBLIC_NOTES_REF.child(data.language).child(data.note_id).child('note').set(data.data.text)
            PUBLIC_NOTES_REF.child(data.language).child(data.note_id).child('edit_date').set(data.data.edit_date)
            resolve()
          } else {
            reject()
          }
        })
      }).catch(err => {
        console.log(err)
        reject()
      })
  }

  if (data.action === 'add') {
    admin.auth().verifyIdToken(data.idToken)
      .then(decodedToken => {
        const uid = decodedToken.uid
        data.note.uid = uid
        const newPrivateNote = Object.assign({}, data.note)
        delete newPrivateNote.isPublic
        delete newPrivateNote.displayName
        delete newPrivateNote.photoURL

        return USER_PRIVATE_REF.child(uid).child('notes').child(data._id).set(newPrivateNote)
          .then(() => {
            progress(10)
            USER_PRIVATE_REF.child(uid).child('notesCount').transaction(i => i + 1)

            if (data.isPublic === true) {
              PUBLIC_NOTES_REF.child(data.language).child(data._id).set(data.note)
              PUBLIC_NOTES_REF.child(`${data.language}NotesCount`).transaction(i => i + 1)
            }

            progress(20)
            NOTES_QUEUE_REF.child(data._id).remove()
          })
          .then(resolve)
          .catch(reject)
      })
  }
})

process.on('SIGINT', () => {
  console.log('Starting queues shutdown')
  notesQueue.shutdown().then(() => {
    console.log('Finished queue shutdown')
    process.exit(0)
  })
})

const app = express()

app.get('/', (req, res) => {
  res.send(`<h1>Hello Universe!</h1>
    <h2>The current time is: ${new Date().toISOString()}!</h2>`)
})

app.listen(3000, () => {
  console.log('Example app listening on port 3000!')
})
