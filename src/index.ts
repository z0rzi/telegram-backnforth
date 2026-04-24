import { Context, Markup, NarrowedContext, Telegraf } from "telegraf";
import { Message, Update } from "telegraf/types";

type FnCallback = (chat: Chat, params: any) => Promise<unknown> | unknown;

function normalize(text: string) {
  return text
    .replace(/[^0-9a-z]+/gi, "")
    .trim()
    .toLowerCase();
}

class Chat {
  constructor(public ctx: Context<Update>) {}

  messageResolve = null as null | ((message: string) => void);
  actionResolve = null as null | ((action: string) => void);
  actionMessage = null as null | Message.TextMessage;

  actionReject = null as null | ((err: string) => void);
  messageReject = null as null | ((err: string) => void);

  private ensureNotWaiting() {
    if (this.messageReject) {
      this.messageReject("OVERWRITTEN");
      this.messageReject = null;
      this.messageResolve = null;
    }

    if (this.actionReject) {
      this.actionReject("OVERWRITTEN");
      this.actionReject = null;
      this.actionResolve = null;

      this.ctx.telegram.editMessageText(
        this.ctx.chat!.id,
        this.actionMessage!.message_id,
        undefined,
        this.actionMessage!.text + "\n\nIgnored...",
      );
      this.actionMessage = null;
    }
  }

  /**
   * Asks the user to choose between multiple options.
   *
   * @param prompt The text to display to the user.
   * @param choices The choices to display to the user.
   * @param columns The number of columns to display the choices in.
   *
   * @returns The payload of the chosen option.
   */
  async waitForChoice<T>(
    text: string,
    choices: { label: string; payload: T }[],
    columns = 2,
  ): Promise<T> {
    this.ensureNotWaiting();

    const labels = choices.map((c) => c.label);

    await this.ctx.reply(
      text,
      Markup.keyboard(labels, { columns }).oneTime().resize(),
    );
    const reply = await this.waitForMessage();

    const option = choices.find((c) => normalize(c.label) === normalize(reply));
    if (!option) {
      throw new Error(`Invalid choice: ${reply}`);
    }

    return option.payload;
  }

  async waitForInlineChoice<T>(
    prompt: string,
    choices: { label: string; payload: T }[],
  ): Promise<T> {
    this.ensureNotWaiting();

    const kb = Markup.inlineKeyboard(
      choices.map((c, idx) => [
        Markup.button.callback(c.label, idx.toString()),
      ]),
    );
    this.actionMessage = await this.ctx.reply(prompt, kb);
    const reply = await this.waitForAction();

    const selectedChoice = choices[+reply];

    // Removing the keyboard
    await this.ctx.telegram.editMessageText(
      this.ctx.chat!.id,
      this.actionMessage!.message_id,
      undefined,
      prompt + "\n\n" + selectedChoice.label,
    );
    this.actionMessage = null;

    return selectedChoice.payload;
  }

  /**
   * Asks the user to confirm (yes/no) something.
   *
   * @param prompt The text to display to the user.
   *
   * @returns true if the user confirmed, false otherwise.
   */
  async waitForConfirm(text: string): Promise<boolean> {
    this.ensureNotWaiting();

    await this.ctx.reply(
      text,
      Markup.keyboard(["No", "Yes"], { columns: 2 }).oneTime().resize(),
    );
    const reply = await this.waitForMessage();

    return reply === "Yes";
  }

  /**
   * Waits for a message from the user and returns it.
   *
   * @param prompt The text to display to the user.
   */
  async waitForText(prompt: string): Promise<string> {
    this.ensureNotWaiting();

    this.ctx.reply(prompt, Markup.removeKeyboard());
    const reply = await this.waitForMessage();
    return reply;
  }

  async waitForNumber(
    prompt: string,
    opts?: {
      min?: number;
      max?: number;
      allowNegative?: boolean;
      allowDecimal?: boolean;
    },
  ): Promise<number> {
    this.ensureNotWaiting();

    this.ctx.reply(prompt, Markup.removeKeyboard());
    let strRx = "\\d+";
    if (opts?.allowNegative !== false) {
      strRx = "-?" + strRx;
    }
    if (opts?.allowDecimal !== false) {
      strRx += "(\\.\\d+)?";
    }

    const rx = new RegExp(strRx);

    let min = opts?.min ?? -Infinity;
    let max = opts?.max ?? Infinity;

    let reply = "";
    while (!rx.test(reply) || +reply < min || +reply > max) {
      if (reply) {
        let msg = "Please enter a number";
        if (isFinite(min) && isFinite(max)) {
          msg += ` between ${min} and ${max}`;
        } else if (isFinite(min)) {
          msg += ` greater than ${min}`;
        } else if (isFinite(max)) {
          msg += ` lower than ${max}`;
        }
        this.ctx.reply(msg);
      }
      reply = await this.waitForMessage();
    }

    return +reply;
  }

  /**
   * Sends a message to the chat
   */
  async sendMessage(text: string) {
    return this.ctx.reply(text);
  }

  /**
   * Internal method, waits for the user to click on an inline button.
   */
  private waitForAction(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.actionResolve = resolve;
      this.actionReject = reject;
    });
  }

  /**
   * Internal method, waits for a text message to be sent by the user.
   * Also gets triggered when the user clicks on a button.
   */
  private waitForMessage(): Promise<string> {
    if (this.messageResolve) {
      throw new Error("There is already someone waiting for a message...");
    }

    const p = new Promise<string>((resolve, reject) => {
      this.messageResolve = resolve;
      this.messageReject = reject;
    });

    return p;
  }

  async onAction(action: string) {
    if (this.actionResolve) {
      this.actionResolve(action);
      this.actionResolve = null;
      this.actionReject = null;
      return true;
    }
    return false;
  }

  /**
   * Called when a user sends a message to the bot.
   * Do not used unless you want to simulate a user sending a message.
   */
  async onMessage(content: string) {
    if (this.messageResolve) {
      this.messageResolve(content);
      this.messageResolve = null;
      this.messageReject = null;
      return true;
    }
    if (this.actionResolve) {
      // We were waiting for an action, but we got a message...
      // We stop the action thread.
      this.ensureNotWaiting();
    }
    return false;
  }
}

type Ctx = NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>;

/**
 * Main class to program the interactions
 */
export default class Bot {
  bot: Telegraf;
  chats = new Map<number, Chat>();

  private allFns = new Map<string, FnCallback>();
  private allCommands = new Map<string, [string, any]>();

  constructor(readonly token: string) {
    this.bot = new Telegraf(token);
    this.bot.on("message", this.onMessage.bind(this));
    this.bot.action(/^\d+$/, (ctx) => {
      const chatId = ctx.chat!.id;

      let chat = this.chats.get(chatId);
      if (!chat) {
        chat = new Chat(ctx);
        this.chats.set(chatId, chat);
      }

      const action = ctx.match[0];
      chat.onAction(action);
    });
    this.bot.launch();
    console.log("Bot started, you can now start chatting with it!");
  }

  private async onMessage(ctx: Ctx) {
    const message = ctx?.message;

    if (!message) return;

    if ("photo" in message) {
      ctx.reply(
        "I see you sent me an image... I'm just going to ignore it, I'm not equipped to handle that yet.",
      );
      return;
    }

    if ("document" in ctx.message) {
      ctx.reply(
        "I see you sent me a document... I'm just going to ignore it, I'm not equipped to handle that yet.",
      );
      return;
    }

    let messageText = "";

    if ("text" in message) {
      messageText = message.text;
    }

    if (!messageText) return;

    const chatId = ctx.chat.id;
    let chat = this.chats.get(chatId);
    if (!chat) {
      chat = new Chat(ctx);
      this.chats.set(chatId, chat);
    }

    if (messageText.startsWith("/")) {
      // It's a command!
      const command = messageText.split(" ")[0];
      const fnInfos = this.allCommands.get(command);
      if (!fnInfos) {
        ctx.reply(`Command ${command} not found.`);
        return;
      }
      this.call(chat, fnInfos[0], fnInfos[1])
        .then(() => {
          // All done. Reset the keyboard.
          ctx.reply("All done.", this.getCommandsKeyboard());
        })
        .catch((e) => {
          if (e === "OVERWRITTEN") {
            // We were waiting for a message or action from the user, but they
            // sent another command.
            // This is fine, we just stop this thread.
            console.warn(
              "Conversation thread was interrupted by another command.",
            );
            return;
          }
          // Something went wrong. Reset the keyboard.
          ctx.reply(
            "An error occured:\n" + e.message + "\n\nAborting.",
            this.getCommandsKeyboard(),
          );
          ctx.reply(e.stack);
        });
      return;
    }

    const handled = await chat.onMessage(messageText);
    if (!handled) {
      // No one was listening...
      ctx.reply(
        "Here are the commands you can use",
        this.getCommandsKeyboard(),
      );
    }
  }

  private getCommandsKeyboard() {
    const keyboard = [] as string[];

    for (const [command] of this.allCommands) {
      keyboard.push(command);
    }

    return Markup.keyboard(keyboard, { columns: 2 }).resize();
  }

  onCommand(text: string, fnName: string, fnParams: any = {}) {
    if (!text.startsWith("/")) {
      text = "/" + text;
    }

    this.allCommands.set(text, [fnName, fnParams]);
  }

  async call(chat: Chat, fnName: string, params: any = {}) {
    if (!this.allFns.has(fnName)) {
      throw new Error(`Function ${fnName} not found.`);
    }
    const fn = this.allFns.get(fnName)!;
    return fn(chat, params);
  }

  fn(name: string, fn: (conv: Chat) => Promise<unknown>) {
    this.allFns.set(name, fn);
  }

  /**
   * To use when you're done with the bot.
   */
  async stop() {
    this.bot.stop();
  }
}
