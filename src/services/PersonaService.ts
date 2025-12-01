import { config } from "../config/env";
import path from "path";
import fs from "fs";

export class PersonaService {
    private persona: any;

    constructor() {
        // Use process.cwd() since we run from project root, data files stay in src/data/
        const personaPath = path.join(process.cwd(), "src", "data", `${config.PERSONA}.json`);
        
        if (!fs.existsSync(personaPath)) {
            console.error(`❌ Persona file not found: ${personaPath}`);
            console.error(`   Available personas: tyler, tina`);
            process.exit(1);
        }
        
        const personaData = JSON.parse(fs.readFileSync(personaPath, "utf-8"));
        this.persona = personaData.persona;
        console.log(`👤 Loaded persona: ${config.PERSONA}`);
    }

    getPersona(): any {
        return this.persona;
    }

    getFormattedPersona(): string {
        const lines: string[] = [];
        const processObj = (obj: any, prefix = "") => {
            for (const [key, value] of Object.entries(obj)) {
                if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                    processObj(value, prefix ? `${prefix} ${key}` : key);
                } else if (Array.isArray(value)) {
                    // Handle arrays of objects (like vehicles)
                    const formatted = value.map(item => {
                        if (typeof item === "object" && item !== null) {
                            return Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(", ");
                        }
                        return item;
                    }).join("; ");
                    lines.push(`${prefix ? prefix + " " : ""}${key}: ${formatted}`);
                } else {
                    lines.push(`${prefix ? prefix + " " : ""}${key}: ${value}`);
                }
            }
        };
        processObj(this.persona);
        return lines.join("\n");
    }
}
