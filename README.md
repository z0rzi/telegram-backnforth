# telegram-backnforth

A lightweight, conversation-first wrapper around [Telegraf](https://github.com/telegraf/telegraf) that makes building interactive Telegram bots feel like writing a simple CLI dialog.

Instead of juggling middleware and state machines, you register **functions** and **commands**, then use intuitive `waitFor*` helpers to pause execution until the user replies.

---

## Installation

```bash
npm install telegram-backnforth telegraf
```

> `telegraf` is a peer dependency — you must install it alongside this package.

---

## Quick Start

```ts
import Bot from "telegram-backnforth";

const bot = new Bot("YOUR_BOT_TOKEN");

bot.onCommand("start", "start");

bot.fn("start", async (chat) => {
  await chat.sendMessage("Welcome! 👋");

  const choice = await chat.waitForInlineChoice("What do you want to do?", [
    { label: "Do something", payload: "something" },
    { label: "Do nothing", payload: "nothing" },
  ]);

  if (choice === "something") {
    await chat.sendMessage("You chose to do something!");
  } else {
    await chat.sendMessage("You chose to do nothing. Fair enough.");
  }
});
```

Run your script, open Telegram, and send `/start` to your bot. The bot will wait for your inline button click before continuing.

---

## Core Concepts

### 1. Register a function with `bot.fn()`

A **function** is an async handler that receives a `Chat` instance. You can call any of the `waitFor*` methods inside it — execution will pause until the user responds.

```ts
bot.fn("askName", async (chat) => {
  const name = await chat.waitForText("What's your name?");
  await chat.sendMessage(`Nice to meet you, ${name}!`);
});
```

### 2. Bind it to a command with `bot.onCommand()`

```ts
bot.onCommand("ask", "askName");
```

Now sending `/ask` in Telegram will trigger the `askName` function.

> The leading `/` is optional in `onCommand` — `"ask"` and `"/ask"` are equivalent.

### 3. Conversation state is per-chat

Each user gets their own `Chat` instance. Multiple users can talk to the bot simultaneously without interfering with each other.

---

## API Reference

### `new Bot(token: string)`

Creates and launches a new Telegraf bot.

| Property | Type | Description |
|----------|------|-------------|
| `token` | `string` | Your Telegram bot token from [@BotFather](https://t.me/botfather) |

The constructor automatically:
- Creates the Telegraf instance
- Attaches message and callback_query handlers
- Calls `.launch()` to start polling

```ts
const bot = new Bot("123456:ABC-DEF...");
```

### `bot.onCommand(text: string, fnName: string, fnParams?: any)`

Binds a slash command to a registered function.

```ts
bot.onCommand("start", "startFn");
bot.onCommand("/help", "helpFn", { showTips: true });
```

When a user sends `/start`, the bot looks up the function named `startFn` and calls it with the optional params.

### `bot.fn(name: string, fn: (chat: Chat) => Promise<unknown>)`

Registers a named function that can be invoked by commands or by `bot.call()`.

```ts
bot.fn("orderPizza", async (chat) => {
  const size = await chat.waitForChoice("Pick a size:", [
    { label: "Small", payload: "S" },
    { label: "Medium", payload: "M" },
    { label: "Large", payload: "L" },
  ]);
  // ...continues after user replies
});
```

### `bot.stop()`

Gracefully stops the bot and ends polling.

```ts
await bot.stop();
```

---

## `Chat` API

Inside every function you receive a `Chat` object representing the current conversation.

### `chat.sendMessage(text: string): Promise<Message>`

Sends a plain text message to the user.

```ts
await chat.sendMessage("Hello!");
```

### `chat.waitForText(prompt: string): Promise<string>`

Displays a prompt, removes the keyboard, and waits for the user to send a text message.

```ts
const name = await chat.waitForText("What's your name?");
```

### `chat.waitForConfirm(text: string): Promise<boolean>`

Displays a Yes/No keyboard and returns `true` if the user clicks "Yes".

```ts
const confirmed = await chat.waitForConfirm("Delete this file?");
if (confirmed) { /* ... */ }
```

### `chat.waitForChoice<T>(text: string, choices: { label: string; payload: T }[], columns = 2): Promise<T>`

Displays a custom reply keyboard with the given choices. Returns the **payload** of the selected option.

```ts
const color = await chat.waitForChoice("Pick a color:", [
  { label: "🔴 Red", payload: "#ff0000" },
  { label: "🟢 Green", payload: "#00ff00" },
  { label: "🔵 Blue", payload: "#0000ff" },
]);
// color will be "#ff0000", "#00ff00", or "#0000ff"
```

The keyboard is one-time and automatically resized.

### `chat.waitForInlineChoice<T>(prompt: string, choices: { label: string; payload: T }[]): Promise<T>`

Displays an **inline keyboard** (buttons attached to the message) instead of a reply keyboard. Better for single-click interactions.

```ts
const action = await chat.waitForInlineChoice("What next?", [
  { label: "Edit", payload: "edit" },
  { label: "Delete", payload: "delete" },
]);
```

### `chat.waitForNumber(prompt: string, opts?): Promise<number>`

Waits for the user to send a valid number. Validates input and re-prompts automatically if invalid.

```ts
const age = await chat.waitForNumber("How old are you?", {
  min: 0,
  max: 120,
  allowNegative: false,
  allowDecimal: false,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `min` | `number` | `-Infinity` | Minimum allowed value |
| `max` | `number` | `Infinity` | Maximum allowed value |
| `allowNegative` | `boolean` | `true` | Whether negative numbers are allowed |
| `allowDecimal` | `boolean` | `true` | Whether decimal numbers are allowed |

---

## Full Example

```ts
import Bot from "telegram-backnforth";

const bot = new Bot(process.env.BOT_TOKEN!);

bot.fn("order", async (chat) => {
  const item = await chat.waitForChoice("What would you like?", [
    { label: "🍕 Pizza", payload: "pizza" },
    { label: "🍔 Burger", payload: "burger" },
  ]);

  const qty = await chat.waitForNumber(`How many ${item}s?`, {
    min: 1,
    max: 10,
    allowDecimal: false,
  });

  const confirmed = await chat.waitForConfirm(
    `Order ${qty}x ${item}?`
  );

  if (confirmed) {
    await chat.sendMessage("Order placed! 🎉");
  } else {
    await chat.sendMessage("Order cancelled.");
  }
});

bot.onCommand("order", "order");
```

---

## Behavior Notes

### Command interruption
If a user is in the middle of a conversation (e.g., waiting for `waitForText`) and sends a new slash command, the current conversation is **silently aborted** and the new command starts. No error is thrown to the user — the old promise simply resolves with `'OVERWRITTEN'` internally.

### Unknown commands
If a user sends a command that hasn't been registered with `onCommand`, the bot replies with:
> `Command /xyz not found.`

### Unknown text
If a user sends plain text and no conversation is waiting for it, the bot replies with:
> `Here are the commands you can use`
> _(plus a keyboard with all registered commands)_

### Photos and documents
Photos and documents are currently ignored with a friendly message. File handling support may be added in the future.

---

## License

MIT
