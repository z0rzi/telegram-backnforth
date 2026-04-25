# telegram-backnforth

A lightweight, conversation-first wrapper around [Telegraf](https://github.com/telegraf/telegraf) that makes building interactive Telegram bots feel like writing a simple CLI dialog.

Instead of juggling middleware and state machines, you register **commands with inline callbacks** and use intuitive `chat.waitFor.*` helpers to pause execution until the user replies.

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

bot.onCommand("start", async (chat) => {
  await chat.send("Welcome! 👋");

  const choice = await chat.waitFor.inlineChoice("What do you want to do?", [
    { label: "Do something", payload: "something" },
    { label: "Do nothing", payload: "nothing" },
  ]);

  if (choice === "something") {
    await chat.send("You chose to do something!");
  } else {
    await chat.send("You chose to do nothing. Fair enough.");
  }
});
```

Run your script, open Telegram, and send `/start` to your bot. The bot will wait for your inline button click before continuing.

---

## Core Concepts

### 1. Register a command with `bot.onCommand()`

Commands are registered by passing a callback directly. The callback receives a `Chat` instance where you can call any of the `waitFor.*` methods — execution will pause until the user responds.

```ts
bot.onCommand("ask", async (chat) => {
  const name = await chat.waitFor.text("What's your name?");
  await chat.send(`Nice to meet you, ${name}!`);
});
```

Now sending `/ask` in Telegram will trigger the callback.

> The leading `/` is optional in `onCommand` — `"ask"` and `"/ask"` are equivalent.

### 2. Conversation state is per-chat

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

### `bot.onCommand(text: string, callback: (chat: Chat) => Promise<unknown>)`

Binds a slash command directly to a callback.

```ts
bot.onCommand("start", async (chat) => {
  await chat.send("Hello!");
});
```

When a user sends `/start`, the bot runs the provided callback with the chat instance.

### `bot.stop()`

Gracefully stops the bot and ends polling.

```ts
await bot.stop();
```

---

## `Chat` API

Inside every command callback you receive a `Chat` object representing the current conversation.

### `chat.send(text: string): Promise<Message>`

Sends a plain text message to the user.

```ts
await chat.send("Hello!");
```

### `chat.waitFor`

An object exposing all the wait helpers. Each one pauses execution until the user responds.

#### `chat.waitFor.text(prompt: string): Promise<string>`

Displays a prompt, removes the keyboard, and waits for the user to send a text message.

```ts
const name = await chat.waitFor.text("What's your name?");
```

#### `chat.waitFor.confirm(text: string): Promise<boolean>`

Displays a Yes/No keyboard and returns `true` if the user clicks "Yes".

```ts
const confirmed = await chat.waitFor.confirm("Delete this file?");
if (confirmed) { /* ... */ }
```

#### `chat.waitFor.choice<T>(text: string, choices: { label: string; payload: T }[], columns = 2): Promise<T>`

Displays a custom reply keyboard with the given choices. Returns the **payload** of the selected option.

```ts
const color = await chat.waitFor.choice("Pick a color:", [
  { label: "🔴 Red", payload: "#ff0000" },
  { label: "🟢 Green", payload: "#00ff00" },
  { label: "🔵 Blue", payload: "#0000ff" },
]);
// color will be "#ff0000", "#00ff00", or "#0000ff"
```

The keyboard is one-time and automatically resized.

#### `chat.waitFor.inlineChoice<T>(prompt: string, choices: { label: string; payload: T }[]): Promise<T>`

Displays an **inline keyboard** (buttons attached to the message) instead of a reply keyboard. Better for single-click interactions.

```ts
const action = await chat.waitFor.inlineChoice("What next?", [
  { label: "Edit", payload: "edit" },
  { label: "Delete", payload: "delete" },
]);
```

#### `chat.waitFor.number(prompt: string, opts?): Promise<number>`

Waits for the user to send a valid number. Validates input and re-prompts automatically if invalid.

```ts
const age = await chat.waitFor.number("How old are you?", {
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

bot.onCommand("order", async (chat) => {
  const item = await chat.waitFor.choice("What would you like?", [
    { label: "🍕 Pizza", payload: "pizza" },
    { label: "🍔 Burger", payload: "burger" },
  ]);

  const qty = await chat.waitFor.number(`How many ${item}s?`, {
    min: 1,
    max: 10,
    allowDecimal: false,
  });

  const confirmed = await chat.waitFor.confirm(
    `Order ${qty}x ${item}?`
  );

  if (confirmed) {
    await chat.send("Order placed! 🎉");
  } else {
    await chat.send("Order cancelled.");
  }
});
```

---

## Behavior Notes

### Command interruption
If a user is in the middle of a conversation (e.g., waiting for `waitFor.text`) and sends a new slash command, the current conversation is **silently aborted** and the new command starts. No error is thrown to the user — the old promise is interrupted internally.

### Unknown commands
If a user sends a command that hasn't been registered with `onCommand`, the bot replies with:
> `Command /xyz not found...`
>
> `Here are the commands you can use:`
>
> _(plus a keyboard with all registered commands)_

### Unknown text
If a user sends plain text and no conversation is waiting for it, the bot replies with:
> `Here are the commands you can use`
> _(plus a keyboard with all registered commands)_

### Photos and documents
Photos and documents are currently ignored with a friendly message. File handling support may be added in the future.

---

## License

MIT
