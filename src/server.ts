// import axios from 'axios'
// import {setTimeout} from 'node:timers/promises'
import dotenv  from 'dotenv'
import express from 'express'
import OpenAI from 'openai'
import WebSocket from 'ws'
import { v4 as uuidv4 } from 'uuid'
import * as console from "console"

dotenv.config({ path: '.env.local' })

// Complain loudly if we don't have an API key
if (!process.env["OPENAI_API_KEY"]) {
  console.error("Error: OPENAI_API_KEY is required but not in .env.local")
  process.exit(1)
}

// Complain loudly if we don't have a main assistant ID
if (!process.env["MAIN_ASSISTANT_ID"]) {
  console.error("Error: MAIN_ASSISTANT_ID is required but not in .env.local")
  process.exit(1)
}

const openai = new OpenAI({
  apiKey: process.env["OPENAI_API_KEY"]
})
const mainAssistantId = process.env["MAIN_ASSISTANT_ID"]

const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.send('Hello! This is the Scott-Bot server.')
})

const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

const wss = new WebSocket.Server({ server })

/**
 * You are a helpful assistant that can reply with code to call the call_assistant function to call other assistants.
 *
 * Assistants available:
 * {"asst_RuxVaVqqQmXV6pf2i3ctOU9i": "Answers everything about weather",
 * "asst_1ttt2l2nGwlZPTz95UTeswCq": "Answers everything about pets",
 * "asst_WPb55mcKngE98mVfaDS00SMt": "Answers everything about everything else"}
 *
 * Function:
 * {
 *   "name": "call_assistant",
 *   "description": "Call another assistant to do work",
 *   "parameters": {
 *     "type": "object",
 *     "properties": {
 *       "assistant_id": {
 *         "type": "string",
 *         "description": "Assistant ID"
 *       },
 *       "prompt": {
 *         "type": "string",
 *         "description": "Prompt to call the assistant with"
 *       }
 *     },
 *     "required": [
 *       "assistant_id",
 *       "prompt"
 *     ]
 *   }
 * }
 */

// Object that stores string keys and thread objects as values
const threads: {[key: string]: OpenAI.Beta.Thread} = {}
const assistants: {[key: string]: OpenAI.Beta.Assistant} = {}


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
    const apiResponse = await callAssistant(mainAssistantId, req.message)

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

async function getThread(threadId = 'Scott-Bot'){
  if (threads[threadId]) return threads[threadId]
  const thread = await openai.beta.threads.create({
    metadata: {
      name: threadId
    }
  })
  threads[threadId] = thread
  return thread
}

async function getAssistant(assistantId: string) {
  if (assistants[assistantId]) return assistants[assistantId]
  const assistant = await openai.beta.assistants.retrieve(assistantId)
  assistants[assistantId] = assistant
  return assistant
}

async function callAssistant(assistantId: string, query: string) {
  const assistant = await getAssistant(assistantId)
  const threadId = (assistantId === mainAssistantId) ? 'Scott-Bot' : uuidv4()
  const thread = await getThread(threadId)
  // Create initial query message
  await openai.beta.threads.messages.create(thread.id, {
    content: query,
    role: 'user'
  })
  // Execute run with assistant
  const run = await openai.beta.threads.runs.create(thread.id,
    {
      assistant_id: assistant.id
    })
  return await getRunResult(assistantId, thread, run)
}

async function getRunResult(assistantId: string, thread: OpenAI.Beta.Thread, run: OpenAI.Beta.Threads.Runs.Run): Promise<string> {
  // Let's wait up to 30 seconds until the run completes
  let count = 0
  while (['in_progress', 'queued'].includes(run.status) && count < 60) {
    await new Promise(r => setTimeout(r, 500))
    // Refresh run status
    run = await openai.beta.threads.runs.retrieve(thread.id, run.id)
    count++
  }
  if (run.status === 'requires_action' || run.status === 'completed') {
    // No tool calls needed, return message directly
    if (!run.required_action) {
      const messages = await openai.beta.threads.messages.list(thread.id, { order: 'desc' })
      const runMessages = messages.data[0].content
      if (runMessages[0].type === 'text') {
        console.log(assistantId + ": \n")
        console.log(runMessages[0].text.value)
        console.log("\n")
        return runMessages[0].text.value
      } else {
        return JSON.stringify(messages.data[0].content)
      }
    }
    // POC: More than 1 tool calls needed - can't support it.
    if (run.required_action.submit_tool_outputs.tool_calls.length > 1) {
      console.error('Error: More than 1 tool call needed - not supported yet')
      console.error(run.required_action.submit_tool_outputs.tool_calls)
      return 'Error: More than 1 tool call needed - not supported yet'
      // TODO: promise.all
    }
    const toolCall = run.required_action?.submit_tool_outputs.tool_calls[0]
    if (toolCall.type !== 'function' || toolCall.function.name !== 'call_assistant') {
      console.error('Error: Unknown tool call')
      console.error(toolCall)
      return 'Error: Unknown tool call'
    }
    const toolCallArguments = JSON.parse(toolCall.function.arguments)
    if (!toolCallArguments.assistant_id || !toolCallArguments.prompt) {
      console.error('Error: Missing tool call arguments assistant_id and/or prompt')
      console.error(toolCallArguments)
      return 'Error: Missing tool call arguments'
    }
    console.log('Calling assistant ' + toolCallArguments.assistant_id + ' with prompt ' + toolCallArguments.prompt)
    // Get tool call response
    const toolCallResponse = await callAssistant(toolCallArguments.assistant_id, toolCallArguments.prompt)
    // Submit it to original thread
    run = await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
      tool_outputs: [
        {
          output: toolCallResponse,
          tool_call_id: toolCall.id
        }
      ]
    })

    return await getRunResult(assistantId, thread, run)
  } else {
    console.error('Error: Assistant run did not complete')
    console.error(run.status)
    return 'Error: Assistant run did not complete'
  }
}

// async function callExternalAPI(query: string) {
//   try {
//     const response = await axios.get(query)
//     return response.data
//   } catch (error) {
//     console.error(error)
//   }
// }

// async function mockCallExternalAPI(query: string) {
//   await setTimeout(1000)
//   return query
// }
