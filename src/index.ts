import { Context, Markup, NarrowedContext, Telegraf } from "telegraf";
import { Document, Message, PhotoSize, Update } from "telegraf/types";

type FnCallback = (chat: Chat) => Promise<unknown>;

function normalize(text: string) {
  return text
    .replace(/[^0-9a-z]+/gi, "")
    .trim()
    .toLowerCase();
}

export class Chat {
  constructor(public ctx: Context<Update>) {}

  waitingFor = "none" as "document" | "photo" | "text" | "action" | "none";

  private resolve = null as null | ((res: unknown) => void);
  private reject = null as null | ((err: unknown) => void);

  /**
   * The message that contains the action buttons.
   * Only used when `this.waitingFor === "action"`
   */
  private actionMessage = null as null | Message.TextMessage;

  private ensureNotWaiting() {
    if (this.reject) {
      if (this.actionMessage) {
        this.ctx.telegram.editMessageText(
          this.ctx.chat!.id,
          this.actionMessage!.message_id,
          undefined,
          this.actionMessage!.text + "\n\nIgnored...",
        );
        this.actionMessage = null;
      }
      this.reject("INTERRUPTED");
      this.reject = null;
      this.resolve = null;
      this.waitingFor = "none";
    }
  }

  waitFor = {
    /**
     * Asks the user to choose between multiple options.
     *
     * @param prompt The text to display to the user.
     * @param choices The choices to display to the user.
     * @param columns The number of columns to display the choices in.
     * @param allowCustom Whether to allow the user to type their own text rather than choosing from the choices.
     *
     * @returns The payload of the chosen option.
     */
    choice: async <T, C extends boolean = false>(
      text: string,
      choices: { label: string; payload: T }[],
      opts?: {
        columns?: number;
        allowCustom?: C;
      },
    ): Promise<C extends true ? string | T : T> => {
      this.ensureNotWaiting();

      const columns = opts?.columns ?? 2;
      const labels = choices.map((c) => c.label);

      await this.ctx.reply(
        text,
        Markup.keyboard(labels, { columns }).oneTime().resize(),
      );
      const reply = await this.waitForMessage();

      const option = choices.find(
        (c) => normalize(c.label) === normalize(reply),
      );
      if (!option) {
        if (opts?.allowCustom) {
          return reply as C extends true ? string | T : T;
        }
        throw new Error(`Invalid choice: ${reply}`);
      }

      return option.payload;
    },

    /**
     * Asks the user to choose between multiple options.
     * Same as `choice`, but displays the options inline right after the prompt
     *
     * @param prompt The text to display to the user.
     * @param choices The choices to display to the user.
     *
     * @returns The payload of the chosen option.
     */
    inlineChoice: async <T>(
      prompt: string,
      choices: { label: string; payload: T }[],
    ): Promise<T> => {
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
    },

    /**
     * Asks the user to confirm (yes/no) something.
     *
     * @param prompt The text to display to the user.
     *
     * @returns true if the user confirmed, false otherwise.
     */
    confirm: async (text: string): Promise<boolean> => {
      this.ensureNotWaiting();

      await this.ctx.reply(
        text,
        Markup.keyboard(["No", "Yes"], { columns: 2 }).oneTime().resize(),
      );
      const reply = await this.waitForMessage();

      return reply === "Yes";
    },

    /**
     * Waits for a message from the user and returns it.
     *
     * @param prompt The text to display to the user.
     */
    text: async (prompt: string): Promise<string> => {
      this.ensureNotWaiting();

      this.ctx.reply(prompt, Markup.removeKeyboard());
      const reply = await this.waitForMessage();
      return reply;
    },

    /**
     * Waits for a number from the user.
     *
     * @param prompt The text to display to the user.
     * @param opts Options to configure the number.
     *
     * @returns The number entered by the user.
     */
    number: async (
      prompt: string,
      opts?: {
        min?: number;
        max?: number;
        allowNegative?: boolean;
        allowDecimal?: boolean;
      },
    ): Promise<number> => {
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
    },

    /**
     * Waits for the user to send a file
     *
     * @param prompt The text to display to the user.
     * @param type How do you want the file to be returned?
     * @param extension The extension of the file to expect.
     *
     * @returns The file as a string or an ArrayBuffer, depending on the `type` parameter.
     */
    document: async <T extends "text" | "buffer" = "text">(
      prompt: string,
      type: T = "text" as T,
      extension?: string,
    ): Promise<T extends "text" ? string : ArrayBuffer> => {
      this.ensureNotWaiting();

      let fileName = undefined as string | undefined;
      await this.ctx.reply(prompt, Markup.removeKeyboard());
      let doc = await this.waitForDocument();
      fileName = doc.file_name;

      while (extension && fileName && !fileName.endsWith(extension)) {
        await this.ctx.reply(`Please send me a ${extension} file`);
        doc = await this.waitForDocument();
        fileName = doc.file_name;
      }

      // Downloading the file
      const fileId = doc.file_id;
      const url = await this.ctx.telegram.getFileLink(fileId);

      return (
        type === "buffer"
          ? fetch(url.href).then((res) => res.arrayBuffer())
          : fetch(url.href).then((res) => res.text())
      ) as Promise<T extends "text" ? string : ArrayBuffer>;
    },

    /**
     * Waits for the user to send a photo
     *
     * @param prompt The text to display to the user.
     *
     * @returns The photo as an ArrayBuffer.
     */
    photo: async (prompt: string): Promise<ArrayBuffer> => {
      this.ensureNotWaiting();

      await this.ctx.reply(prompt, Markup.removeKeyboard());
      const photos = await this.waitForPhoto();

      // We only keep the first photo
      const url = await this.ctx.telegram.getFileLink(photos[0].file_id);
      return fetch(url.href).then((res) => res.arrayBuffer());
    },
  };

  /**
   * Sends a message to the chat
   */
  async send(text: string) {
    return this.ctx.reply(text);
  }

  /**
   * Internal method, waits for the user to click on an inline button.
   */
  private waitForAction(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.resolve = resolve as typeof this.resolve;
      this.reject = reject;
      this.waitingFor = "action";
    });
  }

  /**
   * Internal method, waits for the user to send a file.
   */
  private waitForDocument(): Promise<Document> {
    return new Promise<Document>((resolve, reject) => {
      this.waitingFor = "document";
      this.resolve = resolve as typeof this.resolve;
      this.reject = reject;
    });
  }

  private waitForPhoto(): Promise<PhotoSize[]> {
    return new Promise<PhotoSize[]>((resolve, reject) => {
      this.waitingFor = "photo";
      this.resolve = resolve as typeof this.resolve;
      this.reject = reject;
    });
  }

  /**
   * Internal method, waits for a text message to be sent by the user.
   * Also gets triggered when the user clicks on a button.
   */
  private waitForMessage(): Promise<string> {
    const p = new Promise<string>((resolve, reject) => {
      this.resolve = resolve as typeof this.resolve;
      this.reject = reject;
      this.waitingFor = "text";
    });

    return p;
  }

  /**
   * Called when a user sends something to the bot.
   *
   * @param type The type of the message (photo, document, text, action)
   * @param content The content of the message
   *
   * @returns true if the message was handled, false otherwise
   */
  onUserSent<T>(type: typeof this.waitingFor, content: T) {
    if (this.waitingFor !== type) {
      return false;
    }

    this.resolve!(content);
    this.resolve = null;
    this.reject = null;
    this.waitingFor = "none";
    return true;
  }
}

/**
 * Main class to program the interactions
 */
export default class Bot {
  bot: Telegraf;
  chats = new Map<number, Chat>();

  private allCommands = new Map<string, FnCallback>();

  constructor(readonly token: string) {
    this.bot = new Telegraf(token);
    this.bot.action(/^\d+$/, (ctx) => {
      const chatId = ctx.chat!.id;

      let chat = this.chats.get(chatId);
      if (!chat) {
        chat = new Chat(ctx);
        this.chats.set(chatId, chat);
      }

      const action = ctx.match[0];
      const handled = chat.onUserSent("action", action);
      if (!handled) {
        console.warn("Unhandled action...");
      }
    });
    this.bot.on("message", async (ctx) => {
      const message = ctx?.message;
      if (!message) return;

      const chatId = ctx.chat.id;
      let chat = this.chats.get(chatId);

      if ("photo" in message) {
        const photo = message["photo"];
        const handled = chat?.onUserSent("photo", photo);

        if (!handled) {
          await this.unexpectedInputError(ctx, "photo", chat?.waitingFor);
        }
        return;
      }

      if ("document" in ctx.message) {
        const doc = ctx.message["document"];
        const handled = chat?.onUserSent("document", doc);

        if (!handled) {
          await this.unexpectedInputError(ctx, "document", chat?.waitingFor);
        }
        return;
      }

      let messageText = "";

      if ("text" in message) {
        messageText = message.text;
      }

      if (!messageText) return;

      if (!chat) {
        chat = new Chat(ctx);
        this.chats.set(chatId, chat);
      }

      if (messageText.startsWith("/")) {
        // It's a command!
        const command = messageText.split(" ")[0];
        const callback = this.allCommands.get(command);
        if (!callback) {
          this.showCommands(
            ctx,
            `Command ${command} not found...\n\nHere are the commands you can use:`,
          );
          return;
        }
        callback(chat)
          .then(() => {
            ctx.reply("All done.", this.getCommandsKeyboard());
          })
          .catch((err) => {
            console.error(err);
            ctx.reply(`An error happened...\n\n${err.message}`, this.getCommandsKeyboard());
          });

        return;
      }

      const handled = chat.onUserSent("text", messageText);
      if (!handled) {
        this.unexpectedInputError(ctx, "text", chat?.waitingFor);
      }
    });
    this.bot.launch();
    console.log("Bot started, you can now start chatting with it!");
  }

  private unexpectedInputError(
    ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
    providedType: string,
    expectedType?: Chat["waitingFor"],
  ) {
    if (expectedType === "none" || !expectedType) {
      return ctx.reply(
        `You sent me something, but we weren't in a conversation... Here are the commands you can use:`,
        this.getCommandsKeyboard(),
      );
    }
    return ctx.reply(
      `You sent me a ${providedType}, but I was waiting for a ${expectedType}... I'm just going to ignore it. :)`,
    );
  }

  private showCommands(
    ctx: NarrowedContext<Context<Update>, Update.MessageUpdate<Message>>,
    prompt = "Here are the commands you can use",
  ) {
    return ctx.reply(prompt, this.getCommandsKeyboard());
  }

  private getCommandsKeyboard() {
    const keyboard = [] as string[];

    for (const [command] of this.allCommands) {
      keyboard.push(command);
    }

    return Markup.keyboard(keyboard, { columns: 2 }).resize();
  }

  onCommand(text: string, callback: FnCallback) {
    if (!text.startsWith("/")) {
      text = "/" + text;
    }

    this.allCommands.set(text, callback);
  }

  /**
   * To use when you're done with the bot.
   */
  async stop() {
    this.bot.stop();
  }
}
