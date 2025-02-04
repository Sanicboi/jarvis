import {OpenAI} from "openai";
import TelegramBot from "node-telegram-bot-api";
require("dotenv").config()

const bot = new TelegramBot(process.env.TG_KEY!, {
    polling: true
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY
});


bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(msg.from!.id, "Hello, I am your personal assistant!")
});