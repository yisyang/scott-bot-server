# scott-bot-server

This is the server. For client, see: https://github.com/yisyang/scott-bot-client

This starts a simple express WebSocket server that responds to client requests.

In its POC state, the server is intended to store a list of GPT Assistants,
and consult a Master Assistant on the specialized Assistant to use, and then
get a response from the specialized assistant and return results to the user.

In the future, there needs to be another Assistant Creator assistant that
can be used to generate and evaluate new assistants on the fly.

Client request format:
```
{
    message: string
}
```


Server response format:

```
{
    requestId: string,
    status: 'IN_PROGRESS'|'DONE'|'ERROR',
    response: string
}
```
