import {
  Activity, AlarmClock, Anchor, Angry, Annoyed, Apple,
  AtSign, Award, Baby, Backpack, Banknote, Bed,
  Beef, Bike, Bird, Book, BookMarked, BookOpen,
  Bookmark, Box, Brain, Briefcase, Bug, Building2,
  Bus, Cake, Calendar, CalendarCheck, CalendarDays, Camera,
  Car, Cat, Circle, CircleCheck, ClipboardList, Clock,
  Cloud, CloudLightning, CloudRain, CloudSnow, CloudSun, Coffee,
  Coins, Compass, CreditCard, Diamond, Dog, DollarSign,
  Droplet, Dumbbell, Egg, FileText, Film, Fish,
  Flag, Flame, Flower, Folder, Footprints, Frown,
  Gamepad2, Gauge, Gift, Glasses, Globe, GraduationCap,
  Hash, Headphones, Heart, HeartPulse, Home, Hotel,
  Hourglass, Image, Key, Languages, Laptop, Laugh,
  Layers, Leaf, Lightbulb, Link, List, ListChecks,
  Lock, Luggage, Mail, Map, MapPin, Meh,
  MessageCircle, Mic, Milk, Monitor, Moon, Mountain,
  Music, Newspaper, NotebookPen, Palette, Paperclip, PartyPopper,
  PenLine, Phone, PiggyBank, Pill, Pin, Plane,
  Puzzle, Quote, Rainbow, Receipt, Repeat, Rocket,
  Route, Ruler, Salad, Scale, Shield, Ship,
  Shirt, ShoppingCart, Smile, Snowflake, Sparkles, Sprout,
  Square, Star, Stethoscope, Sun, Sunrise, Sunset,
  Syringe, Tag, Target, Telescope, Tent, Thermometer,
  Ticket, Timer, TrainFront, TreePine, Trees, TrendingUp,
  Trophy, Tv, Type, Umbrella, User, Users,
  Utensils, Video, Wallet, Watch, Waves, Weight,
  Wind, Wrench, Zap,
} from "lucide";
// Extension-qualified so the Node test runner resolves it the same way the bundler does.
import { FALLBACK_PROPERTY_ICON } from "../property-icons.ts";

// Lucide ships each icon as plain data, which renders to both a DOM SVGElement
// (for the CodeMirror widget) and JSX (for the React picker) from one source.
export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// setAttribute spelling. The React twin in components/icons/property-icon.tsx
// spells the same attributes the way JSX wants them.
const SVG_ROOT_ATTRIBUTES: Record<string, string> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
};

const NODES: Record<string, IconNode> = {
  diamond: Diamond, circle: Circle, square: Square, star: Star,
  heart: Heart, flag: Flag, bookmark: Bookmark, tag: Tag,
  hash: Hash, "at-sign": AtSign, pin: Pin, paperclip: Paperclip,
  "map-pin": MapPin, map: Map, globe: Globe, compass: Compass,
  route: Route, home: Home, hotel: Hotel, "building-2": Building2,
  plane: Plane, car: Car, bus: Bus, "train-front": TrainFront,
  bike: Bike, ship: Ship, anchor: Anchor, luggage: Luggage,
  backpack: Backpack, tent: Tent, mountain: Mountain, trees: Trees,
  "tree-pine": TreePine, flower: Flower, leaf: Leaf, sprout: Sprout,
  waves: Waves, footprints: Footprints, ticket: Ticket, telescope: Telescope,
  clock: Clock, "alarm-clock": AlarmClock, calendar: Calendar, "calendar-days": CalendarDays,
  "calendar-check": CalendarCheck, hourglass: Hourglass, timer: Timer, repeat: Repeat,
  sunrise: Sunrise, sunset: Sunset, sun: Sun, moon: Moon,
  cloud: Cloud, "cloud-sun": CloudSun, "cloud-rain": CloudRain, "cloud-snow": CloudSnow,
  "cloud-lightning": CloudLightning, snowflake: Snowflake, umbrella: Umbrella, rainbow: Rainbow,
  thermometer: Thermometer, droplet: Droplet, wind: Wind, gauge: Gauge,
  "trending-up": TrendingUp, scale: Scale, weight: Weight, ruler: Ruler,
  target: Target, award: Award, users: Users, user: User,
  baby: Baby, smile: Smile, laugh: Laugh, frown: Frown,
  meh: Meh, angry: Angry, annoyed: Annoyed, brain: Brain,
  "heart-pulse": HeartPulse, activity: Activity, dumbbell: Dumbbell, bed: Bed,
  pill: Pill, stethoscope: Stethoscope, syringe: Syringe, glasses: Glasses,
  watch: Watch, shirt: Shirt, coffee: Coffee, utensils: Utensils,
  apple: Apple, salad: Salad, milk: Milk, egg: Egg,
  beef: Beef, cake: Cake, gift: Gift, "party-popper": PartyPopper,
  dog: Dog, cat: Cat, bird: Bird, fish: Fish,
  bug: Bug, puzzle: Puzzle, rocket: Rocket, trophy: Trophy,
  sparkles: Sparkles, zap: Zap, music: Music, headphones: Headphones,
  camera: Camera, image: Image, film: Film, video: Video,
  tv: Tv, mic: Mic, "gamepad-2": Gamepad2, palette: Palette,
  book: Book, "book-open": BookOpen, "book-marked": BookMarked, "notebook-pen": NotebookPen,
  "pen-line": PenLine, "file-text": FileText, newspaper: Newspaper, quote: Quote,
  type: Type, languages: Languages, "graduation-cap": GraduationCap, lightbulb: Lightbulb,
  link: Link, mail: Mail, phone: Phone, "message-circle": MessageCircle,
  flame: Flame, wrench: Wrench, laptop: Laptop, monitor: Monitor,
  briefcase: Briefcase, "dollar-sign": DollarSign, wallet: Wallet, "credit-card": CreditCard,
  "piggy-bank": PiggyBank, receipt: Receipt, banknote: Banknote, coins: Coins,
  "shopping-cart": ShoppingCart, list: List, "list-checks": ListChecks, "circle-check": CircleCheck,
  "clipboard-list": ClipboardList, layers: Layers, folder: Folder, box: Box,
  key: Key, lock: Lock, shield: Shield,
};

export function propertyIconNode(name: string): IconNode {
  return NODES[name] ?? NODES[FALLBACK_PROPERTY_ICON];
}

export function renderPropertyIconSvg(name: string) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  for (const [attribute, value] of Object.entries(SVG_ROOT_ATTRIBUTES)) svg.setAttribute(attribute, value);
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of propertyIconNode(name)) {
    const child = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [attribute, value] of Object.entries(attributes)) {
      if (value !== undefined) child.setAttribute(attribute, String(value));
    }
    svg.append(child);
  }
  return svg;
}
