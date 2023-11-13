// import axios from 'axios'
import {setTimeout} from 'node:timers/promises'
import express from 'express'
import WebSocket from 'ws'
import { v4 as uuidv4 } from 'uuid'

const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.send('Hello! This is the Scott-Bot server.')
})

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

const wss = new WebSocket.Server({ server })

wss.on('connection', (ws) => {
  ws.on('message', async (rawMessage) => {
    console.log('received: %s', rawMessage)

    // Ensure that message is proper JSON, and contains "message" key.
    let req
    const requestId = uuidv4()
    try {
      req = JSON.parse(rawMessage.toString())

      // Check if the message has the 'message' key
      if (typeof(req) == 'undefined' || !req.message) {
        ws.send(JSON.stringify({
          requestId: requestId,
          status: 'ERROR',
          response: 'Error: Message must contain a "message" key'
        }))
        return
      }
    } catch (error) {
      ws.send(JSON.stringify({
        requestId: requestId,
        status: 'ERROR',
        response: 'Error: Invalid JSON format'
      }))
      return
    }

    ws.send(JSON.stringify({
      requestId: requestId,
      status: 'IN_PROGRESS'
    }))

    // Handle message
    const apiResponse = await mockCallExternalAPI(`Something about ${req.message}`)

    ws.send(JSON.stringify({
      requestId: requestId,
      status: 'DONE',
      response: apiResponse
    }))
  })

  ws.send(JSON.stringify({
    status: 'CONNECTED',
    response: 'Connection established'
  }))
})

// async function callExternalAPI(query: string) {
//   try {
//     const response = await axios.get(query)
//     return response.data
//   } catch (error) {
//     console.error(error)
//   }
// }

async function mockCallExternalAPI(query: string) {
  await setTimeout(1000)
  return query
}
