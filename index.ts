import { OpenAI } from "openai";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import { EventEmitter } from "stream";
import dayjs from "dayjs";
import schedule from "node-schedule";
import { RunSubmitToolOutputsParamsStream } from "openai/lib/AssistantStream";
import { error } from "console";
require("dotenv").config();

const whiteList = ["Sanicboii"];

const bot = new TelegramBot(process.env.TG_KEY!, {
  polling: true,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

interface IScheduleData {
  date: string;
  time: string;
  name: string;
  data: string;
}

class EventHandler extends EventEmitter {
  public user: number = 0;
  constructor(private assistant: string) {
    super();
  }

  public async onEvent(event: OpenAI.Beta.AssistantStreamEvent) {
    try {
      console.log(event.event);

      if (event.event === "thread.run.requires_action") {
        await this.onRequiresAction(
          event.data,
          event.data.id,
          event.data.thread_id,
        );
      }

      if (event.event === "thread.message.completed") {
        await this.onMessage(event.data);
      }
    } catch (error) {
      console.error("Error handling event:", error);
    }
  }

  private async onMessage(data: OpenAI.Beta.Threads.Messages.Message) {
    for (const c of data.content) {
      if (c.type === "text") {
        await bot.sendMessage(this.user, c.text.value, {
          parse_mode: "Markdown",
        });
      } else if (c.type === "image_url") {
        await bot.sendPhoto(this.user, c.image_url.url);
      } else if (c.type === "image_file") {
        const d = await openai.files.content(c.image_file.file_id);
        const b = await d.arrayBuffer();
        await bot.sendPhoto(this.user, Buffer.from(b));
      } else if (c.type === "refusal") {
        await bot.sendMessage(
          this.user,
          `Refuse to generate. Reason: ${c.refusal}`,
        );
      }
    }
  }

  private async onRequiresAction(
    data: OpenAI.Beta.Threads.Runs.Run,
    runId: string,
    threadId: string,
  ) {
    try {
      if (!data.required_action) throw new Error("No action");
      let res: RunSubmitToolOutputsParamsStream = {
        tool_outputs: [],
      };

      for (const call of data.required_action.submit_tool_outputs.tool_calls) {
        if (call.function.name === "schedule") {
          const input: IScheduleData = JSON.parse(call.function.arguments);
          const date = new Date(`${input.date} ${input.time}`);
          schedule.scheduleJob(input.name, date, async () => {
            await bot.sendMessage(this.user, `${input.name}.\n${input.data}`);
          });
          res.tool_outputs.push({
            output: "Event scheduled successfully",
            tool_call_id: call.id,
          });
        }
      }

      await this.submitCalls(res, runId, threadId);
    } catch (error) {
      console.error("Error processing tool calls:", error);
    }
  }

  private async submitCalls(
    data: RunSubmitToolOutputsParamsStream,
    runId: string,
    threadId: string,
  ) {
    try {
      const stream = openai.beta.threads.runs.submitToolOutputsStream(
        threadId,
        runId,
        data,
      );
      for await (const event of stream) {
        this.emit("event", event);
      }
    } catch (error) {
      console.error("Error submitting tool outputs:", error);
    }
  }
}

class Assistant {
  private id: string = "asst_anu01W3oy2AAVZ3Qx5wHDR8v";
  private thread: string;
  private file = path.join(process.cwd(), ".thread");
  private handler: EventHandler = new EventHandler(this.id);

  constructor() {
    try {
      const files = fs.readdirSync(process.cwd());
      if (!files.includes(".thread")) {
        fs.writeFileSync(this.file, "");
      }
      const data = fs.readFileSync(this.file, "utf-8");
      if (!data) {
        this.createNewThread()
          .then(this.updateThreadFile.bind(this))
          .catch((err) => {
            console.error("Error creating thread", err);
          });
      } else {
        this.thread = data;
      }
    } catch (error) {
      console.error("Error setting up thread file", error);
    }
  }

  private async createNewThread() {
    this.thread = (await openai.beta.threads.create()).id;
  }

  private updateThreadFile() {
    fs.writeFileSync(this.file, this.thread);
  }

  public async updateThread() {
    await openai.beta.threads.del(this.thread);
    await this.createNewThread();
    this.updateThreadFile();
  }

  public async respond(text: string, user: number) {
    await openai.beta.threads.messages.create(this.thread, {
      content: text,
      role: "user",
    });

    this.handler.user = user;

    this.handler.on("event", this.handler.onEvent.bind(this.handler));

    const stream = openai.beta.threads.runs.stream(this.thread, {
      assistant_id: this.id,
    });

    for await (const event of stream) {
      this.handler.emit("event", event);
    }
  }
}

const asst = new Assistant();

bot.onText(/\/start/, async (msg) => {
  if (!msg.from?.username || !whiteList.includes(msg.from?.username)) {
    return await bot.sendMessage(msg.from!.id, "No access");
  }
  await bot.sendMessage(msg.from!.id, "Hello, I am your personal assistant!");
});

bot.onText(/./, async (msg) => {
  if (!msg.from?.username || !whiteList.includes(msg.from?.username)) {
    return await bot.sendMessage(msg.from!.id, "No access");
  }
  if (!msg.text || msg.text?.startsWith("/")) return;

  await asst.respond(msg.text, msg.from.id);
});

bot.onText(/\/reset/, async (msg) => {
  if (!msg.from?.username || !whiteList.includes(msg.from?.username)) {
    return await bot.sendMessage(msg.from!.id, "No access");
  }

  await asst.updateThread();
});
