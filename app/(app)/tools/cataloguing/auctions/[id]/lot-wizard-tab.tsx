"use client"

import { useState, useTransition, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createLot, getLastLotFields, saveLastLotFields, checkBarcodeAssigned, getMyLotsToday } from "@/lib/actions/catalogue"
import { loadSpellDict, findMisspellings } from "@/lib/spellcheck"
import { DEFAULT_REASONS, workingMsBetween, splitStepMs } from "@/lib/idle-timer-config"
import type { IdleReason } from "@/lib/idle-timer-config"
import { IdleReasonPicker, IdleMessageBanner } from "@/components/idle-reason-picker"
import { DEFAULT_CATEGORY_MAP } from "@/lib/lot-categories"
import { useCategoryMap } from "@/lib/use-category-map"
import { buildCondition as buildConditionStr, type BoxPrefixMode } from "@/lib/condition"
import { useConditionWordings } from "@/lib/use-condition-wordings"
import { identityWarning, checkIdentityTrio } from "@/lib/lot-identity"
import { describeActionError } from "@/lib/action-error"
import { isDbReadOnlyBlock, DB_READ_ONLY_MESSAGE } from "@/lib/db-readonly"

// ─── Data ─────────────────────────────────────────────────────────────────────

// Categories are now DB-managed at /admin/categories; this is the bundled default
// (seed + fallback). Re-exported for back-compat with any other importer.
export const CATEGORY_MAP = DEFAULT_CATEGORY_MAP

export const BRANDS_LIST: string[] = [
  // Model railway brands — added 2026-07-16
  "ACE Trains","Airfix GMR","Artitec","Auhagen","Bachmann Branchline",
  "Bachmann Brassworks","Bachmann USA","Bayko","Brimtoy","Darstaed",
  "DCC Concepts","DJ Models","DJH","Dundas Models","Eckon",
  "EFE Rail","Egger-bahn","ESU","Flangeway","Hammant & Morgan",
  "Hamo","Hattons","Hornby","Hornby Acho","Ibertren",
  "Industrial Rail","Kernow Models","Markits","Mashima","Minitrains",
  "Model Rail Magazine","Model Signal Engineering","N Gauge Society","NCE","NuCast",
  "Oxford Rail","Parkside Dundas","PECO","Pike Stuff","Proto 1000",
  "Proto 2000","Ratio","Realtrack","REE Models","Replica Railways",
  "Revolution Trains","Roxey Mouldings","Slaters","Sommerfeldt","South East Finecast",
  "Sunset Models","Superquick","T Gauge","Tri-ang Hornby",
  "Accurascale","Admiral Palou","Citadel & Games Workshop","Distler Figuren","Gilbert Erector",
  "Hinchliffe Models","Johann Haffner","Noris","NZG","Otto Models","Phillip Segal Toys",
  "Product Enterprise","Revell Model Racing","Sungroup","Swatch","The Royal Mint",
  "The Westminster Collection","1320 Inc","21st Century Toys","3M","4D Cityscape",
  "4-Ever Best Friends","5FINITY","A Bug's Life","A Call to Arms","A Girl for All Time",
  "A&A Global Industries","A.C. Gilbert","Aarco","ABACUS","ABC Hobby","Academy",
  "Acamas Toys","Accoutrements","Accucraft","Accurail","Ace Authentic","ACE Novelty",
  "Acedo","Acme","Acoms","Action","Action Packed","Activision","ACW","ADD","Adlung",
  "Adora","AEG","AeroClassics","Aeronaut","AFX","AHM/Rivarossi","Air Hogs","Airfix",
  "Airtronics","Akro Agate","Albedo","Alberon","Alderac Entertainment Group","Aldi",
  "ALEX","Align","Alimrose","ALKEMY","All American","Allens","Allgeyer","Alpaca Warehouse",
  "Alpha Editions","Altaya","Altenburg","ALTER","Aludo","Alvin","Alymer","Amalgam",
  "Amanda Jane","Amanda Sheriff","Amazing Amanda","Amberley Publishing","American Airlines",
  "American Caramel","American Character","American Diorama","American Flyer","American Girl",
  "American Greetings","American Models","American Plastic Toys","American Z Line",
  "Amigo Games","Ammon","AMT","AMT Ertl","AmToy","Anatex","Anchor","Andrea",
  "Andrea Miniatures","Anekke","Angelitos","Anico","Animal Adventure","Animal Alley",
  "Animal Planet","Anker","Annabelle","Annalee","Annalee Dolls","Anne Geddes",
  "Annette Funicello","Annette Himstedt","Ansett","ANSMANN","Anson",
  "Antique Collectors Club","Antique Trader Books","Antonio Juan","AOSHIMA",
  "Applause","Apple Press","Arcane Tinmen","Arcane Wonders","Arclight Games","Arco",
  "Ardleigh Elliott","Argus","Arias","Aristocraft","Aristocrat","Armand Marseille",
  "Armee","Armour","Armourfast","Arnold","Arranbee","Art Asylum","Art Figures",
  "ArtBox","Artesania","Artin","Artipia Games","Arttista","Ashley Belle","Asmadi Games",
  "Asmodee","Asmus Toys","Associated","Aster","Astra","Astrojax","Atari","Athearn",
  "Athena","Atlantic","Atlas","Atlas Games","ATOMIC","Attakus","Aurora","Aurora T Jet",
  "Auscision","Austrains","Authentic Models","Authenticast","AUTOart","Automodello",
  "Avalon Hill","Avatars of War","Avery","Avon","AWM","Axial","Azone International",
  "Baby Alive","Baby Annabell","Baby Born","Baby Face","Baby First","Baby Magic",
  "Baby Stella","Bachmann","Bad Taste Bears","BadCube","Badger Basket","Baitz","Balboa",
  "Bally","Bananagrams","Bananas in Pyjamas","Bandai","BANPRESTO","Banzai","Bar Mills",
  "Barbie","Barclay","Barcrest","Basic Fun","Bassett Lowke","Battat",
  "Battleline Publications","Bauer","Bayer","Bayer Design","Bazooka","BBI","BBR",
  "Bburago","Be A Player","Be Puzzled","BE@RBRICK","Beanie Kids","Beanstalk",
  "Bear Factory","Bearfoots","Bearington","Bearington Collection","Beatrix Potter",
  "Beaver Creek","Beckett","Beffoid","BeGoths","Beleduc","Bell Brand Dodgers","Bemo",
  "Ben Holly","Benbros","Bench Warmer","Berenguer","Bergmann","Berjusa","Berkeley",
  "Berlyn Locomotive works","Bernard Ravca","Besig","Bespaq","Best","Best-Lock",
  "BestPysanky","Betty Boop","Betty Spaghetty","Beverly","Biante","Bicycle","Bif Bang Pow",
  "Big Ben","Big Mouth Toys","Big Potato","Bigjigs Toys","Billing Boats","Bing",
  "Bits And Pieces","Bitty Baby","Bitty Twins","Bizarre","BJ Toys","Blabla",
  "Black Hawk Models","Blade","Blitzway","Blizzard","BLMA Models","Block Doll Company",
  "Bloco","Bloomsbury Publishing","Blue Box","Blue Castle","Blue Ocean Entertainment",
  "Blue Opal","Blue Orange Games","Bluebird","Bluebird Toys","Blues Clues","Blythe",
  "BMW","Bocchetta","Bojeux","Boley","Bon Dufour","Bonikka","Bonnie Brown","Boon",
  "Boots","Boss Fight Studio","Bountiful Baby","Bowen Designs","Bowen Studios","Bowie",
  "Bowman","Bowser","Boyds","Boyds Bears","Bradford Editions","Bradford Exchange",
  "Bradley","Branchline","Brass Button","Brass Key","Bratz","BRAWA","BREKINA",
  "Breyer","Briarpatch","Brigitte Leman","Brinn Dolls","Brinn's","BRIO","Britains",
  "Britains Deetail","Britains Detail","BRM","Broadway Limited Imports","Bronco Models",
  "Brooklin","BRUDER","Bruder Toys","Brumm","BUB","Buddy L","Budgie","Buffalo Games",
  "Build-A-Bear Workshop","Bullyland","Bunnies by the Bay","Burago","Burger King",
  "Burley Games","Burt Industries","Busch","Bushido","Bushiroad","Butterick",
  "C&M Corporation","Cabbage Patch Kids","Cadaco","Caesar","Calbee","California Costumes",
  "Caltoy","Cameo","Cameo Kids","Campbell","Cap Toys","Capcom","Capsule Chix",
  "Car Works","Cararama","Cardinal","Cards Against Humanity","Carl Goldberg","Carousel",
  "Carousel 1","Carpatina","Carrera","Casdon","Catan","Cathay Collection","Ceaco",
  "Celtos Miniatures","Century Collection","Cepia","Chad Valley","Chantilly Lane",
  "Chaosium Inc.","Chaotic","Chap Mei","Character","Charbens","Charisma",
  "Charlie Bears","Cheatwell Games","Cherilea","Cherished Teddies","Chessex","Chicco",
  "Chiltern","Chooch","Chou Chou","Chronicle Books","Chronoscope","Chrysnbon","CIJ",
  "Cinderella","Citco","Classic Carlectables","Classic Metal Works","Classic Toy Trains",
  "Classic Treasures","Clemens","Clementoni","Click N' Play","CLICS","Clothkits","CMC",
  "C-MON","Coarsetoys","Cobble Hill","Coca-Cola","Code 3","Coleco","Coles",
  "Collectible Memories","Collector Books","Collectors Choice","Comedy Central",
  "Comic Images","Commonwealth","Companion Games","Con-Cor","Concord Miniatures",
  "Conrad","Construx","COO MODEL","Cool Mini or Not","Coppenrath","Corgi","Corgi Toys",
  "Corinthian","Corolle","COSETTE","Cosmopolitan","COX","Cracker Jack","Crayola",
  "CRA-Z-ART","Crazy Toys","Creata","Crescent","Crissy Family","Crown and Andrews",
  "Crown Premiums","Crowood Press","Cry Babies","Cryptozoic","Cryptozoic Entertainment",
  "CS Moore Studio","CubicFun","Curious George","Custom Brass","D.A.M","Daiki Rika Kogyo",
  "Daikin","Daisy","Daisy Kingdom","Dal Rossi Italy","DAMTOYS","Dan Dee","Danbury Mint",
  "Danea","Dapol","Dark Heaven Miniatures","Dark Horse","Dark Sword Miniatures","Daron",
  "David Charles","DaVinci Games","Davis Marbles","Dawn","Dayan","Days of Wonder",
  "DC","DC Collectibles","DC Comics","DC Direct","Ddung","Dead Zebra","Dean's",
  "Decipher","Decision Games","Deglingos","Del Prado","Deluxe Reading","Derby Worx",
  "Design Toscano","DesignaFriend","Detail","Detail Master","Diamond Select","Dickie",
  "DID","Difalco","Digimon","Digitrax","Dinky","Discovery Toys","Disguise Costumes",
  "Disney","Disney Pixar","Distler","DISTROLLER","Djeco","DJI","Doepke",
  "Dollfie Dream","Dollmore","Dolls by Berenguer","Dolls by Pauline","Dolls To Play",
  "Dolls World","Dollydoo","Donna Rubert","Donruss","Dooling","Dora the Explorer",
  "Dorfan","Douglas","Dragon","Dragon Action Figures","Dragon Armor","Dragon Models",
  "Dragon Racing","Dragon Wings","Dragonfly","Dream Collection","DreamWorks",
  "Drei Magier Spiele","Dremel","Dron Toys","Drone Force","Drueke","Drumond Park",
  "Ducal","Duncan","Duplo","DuraCraft","Duratrax","Durham Industries","Dust Tactics",
  "Dux","Dwarf Tales Miniatures","Dynamite Entertainment","Dynasty Doll",
  "Eagle","Eaglemoss","Easy & Simple","EBBRO","Eduard","Educa","Educational Insights",
  "Edwin M. Knowles","EFE","Effanbee","E-Flite","EGGER","Eikoh","El Greco","Elastolin",
  "Eldon","Eligor","Elite Sports","Elka Australia","Empire","Emson","Enesco","Enforcer",
  "ENTERBAY","Enterplay","Enya","Epoch","Erector/Meccano","Ertl","Erzi","ESCI","ESKY",
  "Estes","ET","Eugene","Eureka","Eurographics","Ever After High","Exact Detail Replicas",
  "ExactRail","Exoto","Extreme","Fabrique Innovations","Faerie Glen","Falcon Miniatures",
  "FALLER","Famosa","Fancy Nancy","Fans Toys","FansProject","Fantasy Flight Games",
  "Fantization Miniatures","FASA","Fashion Royalty","Fat Brain Toys","Fathead",
  "Ferrari","FERRERO","Ferro-Suisse","FG","Fiesta","Figures Toy Company","Filly",
  "Fireside Games","First & Main","First Gear","First Legion","Fisher-Price",
  "Fitzhenry & Whiteside","Flames of War","Fleer","Fleischmann","Flick Trix",
  "Flight Miniatures","FLM","Floquil","Fly","Flying Frog Productions","FlyingWings",
  "FlySky","Flytech","Flyzone","Folkmanis","Fontanini","Forces of Valor",
  "Forever Friends","Forum Novelties Inc","Four Horsemen","Fox","Fox Valley Models",
  "FPG","Fragor Games","Franklin Heirloom","Franklin Mint","Frateschi","Fresh Dolls",
  "FROG","FRONTLINE","F-Toys","Fujimi","FULGUREX","Fun World","Fundex","Funko",
  "Funline","Funrise","Funville","Furby","Furga","FurReal Friends","Furuta","FuRyu",
  "Fusilier","Futaba","Futera","G&S","Gabriel","GADCO","Gale Force Nine","Galoob",
  "Gama","Games Workshop","Gamesfactory","Gamewright","Gamezone Miniatures","GANZ",
  "Gasser","Gaugemaster","Gaultier","Gearbox","GeminiJets","Gemmy","Gemodels",
  "Gene Marshall","General Hobby","General Mills","Gentle Giant","Geomag",
  "George Williams","Georgetown","GeoSafari","Geppeddo","Gerber","GIANTmicrobes",
  "Gigamic","GIGO","Gilbert","GIOCHI PREZIOSI","GirlznDollz","Glasslite","Glencoe",
  "Glitter Girls","GMC Publications","GMP","GMT","Godfrey Phillips","Goebel","Gogo's",
  "Goldberg","Goldberger","Golden","Golden Wheel","GoldieBlox","Goliath",
  "Good Smile Company","Goodman Games","Gorham","Gottlieb","Goudey","GPM",
  "Grace Putnam","Graco","Grafix","Graham Farish","Grand Slam Ventures","Grandt Line",
  "Graupner","Great Planes","Greater Than Games","Greenlight","Grisly","Groove",
  "Groovy Girls","Gudrun Legler","Guidecraft","Guild","Guillows","Guiloy","GUISVAL",
  "GUND","Gundam","Gunze","GWS","HABA","Hachette","Hachette Books","Hacker","HAG",
  "Hairdorables","Hallmark","Halsam","Hamleys","Hangar 9","Hansa","Hape",
  "Happy Nappers","Hard Rock Cafe","Harley-Davidson","Harriman House Publishing",
  "Harrods","Hasbro","Hasegawa","Hasslefree Miniatures","HaT","hauck","Haynes",
  "Hearthsong","Heartland","Hearts for Hearts Girls","Heidi Ott","Heidi Plusczok",
  "Helimax","Heljan","Helldorado","Heller","Hello Kitty","Herald","Heresy Miniatures",
  "Hermann","HEROCROSS","Herpa","Hess","Heye","High Planes","Highway 61/DCP",
  "Hirobo","Historex","HMH","Hobby Master","HobbyBoss","Hobbycraft","Hobbywing",
  "HobbyZone","Hogan","Holly Hobbie","Homcom","Homies","Hot Bodies","Hot Toys",
  "Hot Wheels","House of Lloyd","House of Marbles","House of Staunton","How2work",
  "Hoyle","HPI","Hubley","Hubsan","Hudson River","Huffy","Hugmeez","Huki","Humbrol",
  "Hungry Jack","Husky","ICM","Ideal","IELLO","Ignite","IHC","Ikarus",
  "Imaginarium","Imagination","Imaginext","IMC","Imc Toys","IMEX","Impact Miniatures",
  "Impel","Imperial","In the Breeze","In the Game","In The Night Garden","Incredibles",
  "Incursion","Infinity Miniatures","INKWORKS","Innova","Innovation First",
  "Integrity Toys","Integy","International Playthings","Intex","Iplehouse",
  "Iron Crown Enterprises","Iron Factory","Iron Kingdom Miniatures","Iron Stop",
  "Iron Wind Metals","IRWIN","Italeri","IVES","IXO","Jacks Pacific","Jada Toys",
  "Jadi","JAKKS Pacific","Jamara","Jan Mclean","Jazwares","JC Toys","Jellycat","Jem",
  "Jenny","Jesco","Jesmar","JNF","Joal","Johnny Lightning","Jouef","Journey Girls",
  "Joustra","JPM","Jubilee","Judges Guild","Jumbo","Jumeau","Jun Planning",
  "Jurassic World","Just Play","Kadee","Kahn's","Kaijudo","Kaiyodo","Kalmbach",
  "Kamar","Karito Kids","Kar-Line","Karmin","Kate Finn","Katherine's Collection",
  "KATO","Kaydora","Kaye Wiggs","Keel Toys","Kellermann","Kellogg's","Kellytoy",
  "Kenner","Kennyswork","Kentoys","Kestner","KETTLER","Kewpie","Kibri","Kid Kore",
  "Kidkraft","Kidrobot","Kids Logic","Kids Preferred","Kidz & Cats","kimmidoll",
  "Kinder","King & Country","King Motor","Kingstate","Kinsmart","Kish","Kiss",
  "KK-Scale","Klein Modellbahn","K-Line","Klumpe","Km 1","K'NEX","Knickerbocker",
  "Knight Models","KO PROPO","Koala Baby","Koford","Konami","Konatsuya","Koplow Games",
  "Korimco","Kosmos","KOTOBUKIYA","Kraftz","Kranich","Krause Publications","KRE-O",
  "Krick","Krolyn","Kromlech","KS Toys","Kumik","Kurhn","Kurt S. Adler","Kyosho",
  "L.O.L. Surprise!","La Nina","Lakeside","Lalaloopsy","LAMO","Lanard","Lansdowne",
  "Lauer","Laura Lee Eagles","Le Toy Van","Leaf","LeapFrog","Learning Advantage",
  "Learning Carpets","Learning Curve","Learning Resources","Lee Middleton","Legler",
  "LEGO","Lehmann","Lemaco","Lenci","LENNOX","Lenz","LEONARDO","Lesney","LGB",
  "Libellud","Liberty Classics","Liebherr","Life-Like","Lil' Bratz","Lili Ledy",
  "Liliput","Lima","Lincoln Logs","Linda Mason","Linda Rick","Lindberg","Lineol",
  "LINKA","Linzy Toys","Lion King","Lionel","Lissi","Little Mommy","Little People",
  "Little Tikes","Littlest Pet Shop","Living Dead Dolls","Living Puppets",
  "LJN","Lledo","Llorens","Lollipop Girls","Lone Star","Look Smart","Lookout Games",
  "Losi","Louis Marx Toys","Loungefly","Lovee Doll","Loving Family","LRP","Lucotte",
  "Luna Baby","Lundby","Luts","Luvabella","Luvley","M&M's","Marklin","M2 Machines",
  "Madame Alexander","Madeline","MAGFORMERS","Maggie Iacono","Magic Attic",
  "Magic Makers","Magna-Tiles","Magnetix","Magnus","Maia & Borges","Maileg",
  "Mainline","Maisto","Majorette","Malifaux","mamas & papas","Mamod","Manhattan Toy",
  "Manoil","Mantic","Mantua","Marble King","Marchon","Marian Yu Designs",
  "Marie Osmond","Marie Osmond Dolls","Marina Luna","Mark Hopkins","Marlborough",
  "Marvel","Marvel Legends","Marvel Toys","Marx","Mary Engelbreit","Mary Hoyer",
  "Mary Meyer","Mary Quant","Masha and The Bear","Master Made","Mastermind Creations",
  "Masterpiece","MasterPiece Dolls","MasterPieces","MATAGOT","Matchbox","Mattel",
  "Max Factory","Maxi Car","MaxMini","Mayday Games","Mayfair Games","MB","McCall's",
  "McDonald Publishing Company","McDonald's","McFarlane Toys","Mebetoys","Meccano",
  "MEDICOM","Medicom Toy","Medicos","MEGA","Mega Bloks","MEGA Brands","MegaHouse",
  "Megatech","Mego","MEHANO","Melissa & Doug","Memory Lane","Mercury","Merlin",
  "Merrythought","Merten","Metcalfe","Mezco","MGA","MGA Entertainment","Micro Machines",
  "Micro-Trains Line (MTL)","Midgetoy","Mighty Jaxx","Mignot","Milestone",
  "Mill Creek Studios","Milton Bradley","Minicraft","Miniland Educational","Minimates",
  "Minitrix","MINICHAMPS","MiP","Mirage","MJX","Mobilo","Model Motoring","Model Power",
  "Model-Icons","Moebius Models","Monster High","Moonmo","Moose Enterprise","Moose Toys",
  "Mooshka","Morgan Cycle","Moshi Monsters","Mothercare","MOTORMAX",
  "Motorsports Authentics","Moulin Roty","Moxie Girlz","MPC","MR Collection",
  "Mrs. Beasley","MTH","MTL","Mugen","Mugen Seiki","MULTIPLEX","Mundia","Muppets",
  "Muscle Machines","My Child","My Life As","My Little Pony","My Scene","My Sweet Baby",
  "My Twinn","Mystery","NABCO","Naber","Nabisco","Namco","Nanco","Nancy Ann",
  "Nanoblock","National Chicle","NECA","Nendoroid","Neo Scale Models","NERF",
  "New Bright Industrial Co.  Ltd","New-Ray","Nichimo","Nickelodeon","Nikko","Ninco",
  "Nintendo","NJ International","Noah's Ark","Noch","NODDY","Norah Wellings","NOREV",
  "NORFIN","Norscot","North American Bear Company","North Star Games","Nostalgie",
  "NOVA","Novak","Novarossi","NPKdoll","NSR","Nylint","Obitsu","Octopus Books",
  "Ohio Art","Olmec","OMEGA","Omnibot","one2believe","Only Hearts Club","Onyx",
  "Open Wheel","ORCARA","Orchard Toys","Orion","OS","Otaki","Otherworld Miniatures",
  "Our Generation","Oxford Diecast","OzMods","Pacific","Pacific Fast Mail","Paizo",
  "Paladone","Palisades","Palitoy","Palladium Books","Pamela Erff","Panini",
  "Panosh Place","Paola Reina","Papo","Paradise Galleries","Parker Brothers","ParkZone",
  "Parma","Pathfinder Miniatures","Patricia Loveless","Pauline","Pedigree",
  "Peg Perego","Pegasus","Peggy Nisbet","Peligree","Penguin Publishing Group",
  "Pepper","Pepsi","Perfect Effect","Pete Fowler","Petitcollin","PetWORKs","PEZ",
  "Pfeiffer","PHICEN","Philadelphia Gum","Philos","Picco","PIKO","Pillow Pets",
  "PineCar","Pinnacle","Pixar","Pixel Pets","Pizza Hut","Planet Hollywood","Planet X",
  "Plano Model Products","PlanToys","Plastic Fantasy","Plasticville","PLASTRUCT",
  "Play Arts","Play Visions","PlayArt","Playcraft","Play-Doh","Playgro",
  "Playing Mantis","Playmates Toys","PLAYMOBIL","Playroo","Playskool","Plettenberg",
  "Plushland","Pluto","PNSO","Pocher","POLA","Polar Lights","Polistil","Politoys",
  "Polly Pocket","Pomegranate","Poopsie","Popaganda","POPY","Pororo","Portal Games",
  "Pottery Barn","Power Patrol","Power Slot","PowerLine","Powerpuff Girls",
  "Praline","Precious Moments","Precision Craft","Preiser","Premium ClassiXXs",
  "Press Pass","Pressman","Prism","Privateer Press","Pro Boat","Pro Set","ProCards",
  "Pro-Line Racing","PROTOCOL","Pullip","Puzzle Buddy","Puzzlebug","Pyro",
  "Q-workshop","R.John Wright","Racing Champions","Rackham","Rackham Entertainment",
  "Radica","Radio Flyer","Ragtales","Rainbow Brite","Rainbow Works","Ralston",
  "Ramsay's","Rapido","Rastar","Ravensburger","RC2","RCCA","RealToy","Reamsa",
  "Reaper","Reaper Miniatures","Reborn","Red Caboose","Redcat Racing","Reeder",
  "Reedy","Regal","Regina","Remco","Re-Ment","Renegade Game Studios","Renwal",
  "Repos Production","Retro Games","Revell","Revlon","Revoltech","Rio",
  "Rio Grande Games","Rittenhouse","Rivarossi","Road Champs","Road Legends",
  "Robbe","Robert Tonner","Robin Woods","Robitronic","RoboRaptor","RoboSapien",
  "Roco","Roddy","Rokal","Roken","Roldan","Ronin","Round 5","Roundhouse","Rovan",
  "Roy Toy","Royal","RP Toys","RPE","RPM","Rubens Barn","Rubie's","Rugrats",
  "Russ","Rustie","Ruth Treffeisen","S.H.Figuarts","Sabertooth Games","Sachsenmodelle",
  "SAE","Safari","SAGE","SAICO","Sailor Moon","Saito","Salada","Saleen","Sanrio",
  "Sanwa","Sasha","Savage Worlds Miniatures","Scaletrains.com","Scalextric",
  "Scablens","Schabak","Schaper","Schleich","Schmid","Schoenhut","Scholastic",
  "Schuco","Schumacher","Schweizer","Schwinn","Schylling","Scooby Doo","SCX",
  "Seagull","Sears","SEGA","Sekiguchi","Selchow & Righter","Select","Selecta",
  "Senario","Serendipity","Serpent","Seymour Mann Dolls","Shackman","Shell",
  "Shell Classic","Shibajuku Girls","Shopkins","Showcase Model","ShowStoppers",
  "Sideshow Collectibles","Sievers","SIG","Sigikid","Signature Models","SIKU",
  "Silver Cross","Silverlit","Simba","Simba Dickie Group","Simon & Halbig",
  "Simpich","Sindy","Skip Hop","SkyBox","Slixx","Slot.it","Smartech","SmartGames",
  "Smith Miller","Smithsonian","Smoby","SMTS","Soda Pop Miniatures","Soldier Story",
  "Solido","Soma","SONOKONG","Sony","SOTA Toys","Spark","Spartan Games","SpecCast",
  "Spectrum","Speed Stacks","Speedwell","Spektrum","Sphero","Spin Master","Spirograph",
  "Sport Kings","Sportflics","Sportscaster","Springbok","Square Enix","Squinkies",
  "Stack & Stick","Star Trek","Star Wars","Starline","Starlux","Steepletone",
  "Steiff","Step2","Sterling Models","Sterntaler","Steve Jackson Games","Stewart",
  "Stikbot","Stonemaier Games","Strangeco","Strat-O-Matic","Strawberry Shortcake",
  "Stretch Armstrong","Strombecker","Stronghold","Structo","Sturditoy","Suncoast",
  "Sunshine Family","SunsOut","Sunstar","Super Duck","Super7","Susan Lippl",
  "Susan Wakeen","Suzanne Gibson","Sweet Streets","Swoppet","Sylvanian Families",
  "Sylvia Natterer","Syma","T2M","Takara","Tamashii Nations","Tamiya","Tammy",
  "Tazo","TBLeague","Team Associated","Teamcoach","Tech Deck","Technosource",
  "TED","Teddy Scares","Teddy-Hermann","Teddy-Hermann GmbH","Tekno","Tenshodo",
  "Tenyo","Terri Lee","Testors","TFC Toys","The Ashton-Drake Galleries",
  "The Bridge Direct","The Hamilton Collection","The Leonardo Collection",
  "The Loyal Subjects","The New York Doll Collection","The Queen's Treasures",
  "The Simpsons","The Teddy Bear Collection","The Vogue Doll Company","The Wiggles",
  "ThinkFun","ThinkGeek","Thinkway Toys","Thomas & Friends","Thomas Dam","ThreeA",
  "ThreeZero","Thunder Castle Games","Thunder Tiger","Thunderbirds","Tiger",
  "Tiger Electronics","Timpo Toys","Tinkertoy","Tipp and Co.","Tipple Topple",
  "Titan","TLR","TNT","Tobar","tokidoki","Tokyo Marui","Tomica","Tomix","TOMY",
  "Tonka","Tonner","TootsieToy","Top Flite","Top Gear","Top Marques","Top Model",
  "Top Trumps","Topper","Topps","ToyBiz","ToyMakers","Toynami","Toys R Us",
  "Tradition","Trainorama","Transogram","TRAX","Traxxas","Trefl","Trendmasters",
  "Tri-ang","Tri-ang Railways","Trinity","Trio","Tristar","Trix","Trix Express",
  "Trofeu","Troll Lord Games","TRONICO","TrueScale Miniatures","Trumpeter","Tru-Scale",
  "TSR","TUDOR","Turner Entertainment","Tweenies","Twirlywoos","Twisty Petz",
  "Ty","TYCO","Tyler Wentworth","U.B. Funkeys","Ultimate Guard","Ultimate Soldier",
  "Ultra PRO","Unbox Industries","Unbranded","Uncle Milton","Uneeda","Unimax",
  "Union","UNIPAK","Unique Toys","Universal Hobbies","University Games","Upper Deck",
  "UT","Valerie Jackson","Van Hygan & Smythe","Vanguards","Vapex","VARIO","Varney",
  "Venom","Verem","Verlinden Productions","Vermont Teddy Bear","Very Hot Toys",
  "Victrix Limited","Viessmann","Vitesse","Vivid Gaming","Vivid Imaginations","Vogue",
  "Void Miniatures","Volks","Vollmer","VTech","Vts Toys","Waldorf","Walkera",
  "Wallace & Grommit","Walthers","Wange","War Gods","Warbotron","Warcradle Studios",
  "Wargames Factory","Warlord Games","WarMachine Miniatures","Warman's Dolls",
  "Warner Bros.","Warners Group Publications","Watch Ya' Mouth","Water Babies",
  "Webkinz","Webra","WEDICO","WEG","Weico","Weiss Schwarz","WELLY","Wendal",
  "Wendy Lawton","West End Games","Wham-O","Wheaties","White Mountain","White Rose",
  "White Wizard Games","White Wolf","WhiteBox","Whitman","Wicked Cool Toys","WIKING",
  "Wild Planet","Wild Republic","Wilde Imagination","Wilesco","Williams","Wills",
  "Winner's Circle","Winning Moves","Winross","Winx Club","Witty Toys",
  "Wizards of the Coast","WizKids","Wizzard","Woodland Scenics","World & Model",
  "World Bazaar","World Gallery","World Peacekeepers","Worlds of Wonder","WORLDTECH",
  "WOW","WowWee","Wrebbit","Wrenn Railways","WSI","Wurlitzer","WWE","Wyandotte",
  "Wyrd","Xavier Roberts","XM Studios","X-Plus","XPV","XRAY","X-Toys",
  "X-TRANSBOTS","YAMATO","Yanoman","Yat Ming","Yokomo","Yomega","You Me",
  "Young Miniatures","YoYoFactory","Zak's","Zapf","Zapf Creation","Zapf Creations",
  "Zelfs","Zenoah","Zeuke","Zibits","ZICA","ZipZaps","Zizzle","Z-Man Games",
  "Zoch","Zvezda","Zwergnase","Zylmex","RealTrack Models","Hornby Dublo","Alan Gibson",
]

const CAT_ACCENT     = "#2AB4A6"
const CONDITIONS     = ["Mint", "Near Mint", "Excellent", "Good Plus", "Good", "Fair", "Poor"]
const PARCEL_OPTIONS = ["Small", "Medium", "Large", "Contact", "Collection Only"]
const ESTIMATE_VALUES = [5,10,15,20,25,30,35,40,45,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200]
const STEP_LABELS    = ["Vendor & Tote", "Barcode", "Key Points", "Categories", "Estimate", "Condition", "Parcel Size", "Photos"]

// ─── Autocomplete ─────────────────────────────────────────────────────────────

function Autocomplete({ value, onChange, options, placeholder, tablet }: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  tablet?: boolean
}) {
  const [open, setOpen] = useState(false)
  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase())).slice(0, 50)
  return (
    <div className="relative">
      <div className="flex">
        <input value={value} onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className={`flex-1 bg-gray-100 dark:bg-[#2C2C2E] border border-r-0 border-gray-300 dark:border-gray-700 rounded-l text-gray-700 dark:text-gray-200 focus:outline-none ${tablet ? "px-4 py-3.5 text-base" : "px-3 py-2 text-sm"}`}
          style={{ borderColor: value ? CAT_ACCENT + "66" : undefined }} />
        <button type="button" onMouseDown={e => { e.preventDefault(); setOpen(o => !o) }}
          className={`bg-gray-100 dark:bg-[#2C2C2E] border border-l-0 border-gray-300 dark:border-gray-700 rounded-r text-gray-600 dark:text-gray-500 ${tablet ? "px-3 text-sm" : "px-2 text-xs"}`}>▼</button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded mt-0.5 max-h-48 overflow-y-auto shadow-xl">
          {filtered.map(opt => (
            <button key={opt} type="button" onMouseDown={() => { onChange(opt); setOpen(false) }}
              className={`w-full text-left px-3 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#3A3A3C] transition-colors ${tablet ? "py-3 text-base" : "py-1.5 text-sm"}`}>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Condition button ─────────────────────────────────────────────────────────

function CondBtn({ label, selected, onClick, tablet }: { label: string; selected: boolean; onClick: () => void; tablet?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded font-medium transition-colors ${tablet ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"}`}
      style={{
        background: selected ? CAT_ACCENT : "#2C2C2E",
        color: selected ? "#1C1C1E" : "#d1d5db",
        border: `1px solid ${selected ? CAT_ACCENT : "#374151"}`,
        touchAction: tablet ? "manipulation" : undefined,
      }}>
      {label}
    </button>
  )
}

// localStorage key base for the idle-timer heartbeat (persists last-activity time
// across page closes). Keyed per user so a shared iPad doesn't blame one
// cataloguer for another's gap.
const IDLE_HEARTBEAT_BASE = "vectis_idle_last_activity"

// A gap of a full working day or more (09:00–17:00 = 8h) is a holiday or a long
// absence, not a break — never asked about, in either idle check.
const EIGHT_WORK_HOURS_MS = 8 * 60 * 60 * 1000

// A lot that already holds the barcode being entered — the shape returned by
// checkBarcodeAssigned.
type DupeHit = {
  title: string
  barcode: string | null
  receiptUniqueId: string | null
  auctionCode: string
  auctionName: string
  sameAuctionId: string | null
  createdByName: string | null
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LotWizardTab({
  auctionId,
  auction,
  userId,
  userName,
  onCreated,
  tablet,
  showScanTimer = true,
  showLotTimer = false,
  timerRedMins = 30,
  manualDescriptions = false,
}: {
  auctionId: string
  auction: { code: string; name: string }
  userId?: string
  userName?: string
  onCreated: () => void
  tablet?: boolean
  showScanTimer?: boolean
  showLotTimer?: boolean
  timerRedMins?: number
  /** This cataloguer writes their own descriptions: no Key Points, always excluded from AI. */
  manualDescriptions?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [barcodeWarning, setBarcodeWarning] = useState(false)
  // Step-2 warning: this barcode is already assigned to a lot somewhere in the
  // app. Filled from a live server check, not from the loaded lots — see
  // checkBarcodeAssigned.
  const [dupeWarning, setDupeWarning] = useState<DupeHit | null>(null)
  // The check itself failed (offline, DB down). Surfaced rather than swallowed:
  // silently continuing would wave through the duplicate it was meant to catch.
  const [dupeCheckError, setDupeCheckError] = useState<string | null>(null)
  const [checkingBarcode, setCheckingBarcode] = useState(false)
  const [step1LengthWarning, setStep1LengthWarning] = useState(false)
  // Step-4 warning: a hand-typed category that doesn't match the preset list
  // (which mirrors BC) — "main" or "sub" says which field failed.
  const [categoryWarning, setCategoryWarning] = useState<"main" | "sub" | null>(null)
  // Step-5 warning: Estimate Low higher than Estimate High (almost always a swap/typo).
  const [estimateWarning, setEstimateWarning] = useState(false)

  const barcodeStartedAt   = useRef<number | null>(null)
  // The little blue count-up timer (showLotTimer) counts from HERE — set when the
  // barcode is actually entered, NOT on field focus. Kept separate from
  // barcodeStartedAt (which is the activity/duration baseline set on focus) so the
  // visible timer doesn't appear before the cataloguer has entered a barcode.
  const lotTimerStartedAt  = useRef<number | null>(null)
  const keyPointsEnteredAt = useRef<number | null>(null)
  const keyPointsAccumMs   = useRef<number>(0)
  // Guard against runaway auto-creation (e.g. a barcode scanner left in
  // continuous/wedge mode repeatedly activating Save): remember the last saved
  // barcode + time so the same barcode can't be saved again and saves can't fire
  // in rapid succession.
  const lastSavedBarcode   = useRef<string>("")
  const lastSavedAt        = useRef<number>(0)

  // Idle detection. lastActivityRef = when the user last saved a lot (or answered
  // an idle prompt). 0 = no baseline known yet — page-open time is deliberately
  // NOT treated as activity, so a fresh browser never accuses anyone.
  const lastActivityRef    = useRef<number>(0)
  const idleStartedAtRef   = useRef<number>(0)
  // The gap the cataloguer has already answered for. The server gate can still say "not
  // enough", but we do not ask twice about the same gap — see the needsIdle branch in the save.
  const answeredGapRef     = useRef<number>(0)
  // When the popup was raised (≈ the end of the gap) — shown as the "from … to …"
  // window so the cataloguer can see exactly which period they're accounting for.
  const idleEndedAtRef     = useRef<number>(0)
  const [idlePopup,        setIdlePopup]      = useState(false)
  const [idleSecs,         setIdleSecs]       = useState(0)
  // Multi-select (2026-07-23): several reasons can be picked and the time divided
  // between them with quick sliders — a rough split is fine. Sliders are FULLY
  // MANUAL (Jordan: no auto-adjusting): each selected reason starts at 0m and
  // only moves when dragged; a live "Not allocated" line shows what's left, and
  // whatever remains on submit is logged under the UNALLOCATED pseudo-reason.
  // idleNotesMap holds a note per reason for reasons that need one.
  const [idleSelected,     setIdleSelected]   = useState<string[]>([])
  const [idleAlloc,        setIdleAlloc]      = useState<Record<string, number>>({})
  const [idleTotes,        setIdleTotes]      = useState("")
  const [idleNotesMap,     setIdleNotesMap]   = useState<Record<string, string>>({})
  // Tapping "Other" first shows a reminder to use a listed option if one fits —
  // Other is only selected once they confirm none of them do.
  const [idleOtherWarn,    setIdleOtherWarn]  = useState(false)
  // Submitting with time left unassigned asks for confirmation first — they can
  // go back and allocate it, or continue and have it recorded as unallocated.
  const [idleUnallocWarn,  setIdleUnallocWarn] = useState(false)
  const [idleSubmitting,   setIdleSubmitting] = useState(false)
  const [idleReasons,      setIdleReasons]    = useState<IdleReason[]>(DEFAULT_REASONS)
  // Optional note from Admin → Activity Timer, shown above the reasons. Blank = no banner.
  const [idleMessage,      setIdleMessage]    = useState<string>("")
  // The idle log failed to save — shown in the popup. We do NOT wave the user
  // through on a failure: an unrecorded gap is the whole problem this exists to
  // stop. Nothing is lost by blocking, because saving the lot needs the same
  // server anyway.
  const [idleError,        setIdleError]      = useState<string | null>(null)
  // Set when the popup was raised BY A SAVE (the walk-away-mid-lot case) rather
  // than by starting a lot. The save resumes once the reason is logged.
  const pendingSaveRef     = useRef<boolean>(false)
  // When the user last TOUCHED the lot in progress — typing, tapping, changing a
  // field. Idle within a lot is measured from here, not from when the lot began,
  // so working on it resets the clock and only genuine gaps are ever counted.
  const lastInteractionRef = useRef<number>(0)
  // True while the popup is reporting a gap that happened INSIDE a lot (either
  // check), as opposed to a gap between lots.
  const idleWithinLotRef   = useRef<boolean>(false)
  // Idle logged so far within the lot in progress. The lot's own duration still
  // counts the full wall-clock time (two hours of research means the lot took two
  // hours) — this is the "of which, idle" figure that sits inside it.
  const lotIdleAccumRef    = useRef<number>(0)
  // ⚠⚠ The LONGEST inactive stretch seen so far during the lot in progress, and when it
  // began. Without this the evidence of a walk-away was destroyed by the first touch on
  // returning: noteInteraction() reset lastInteractionRef, so the save-time check measured
  // seconds and never asked. Measured on a real lot (2026-08-19) whose own duration was
  // 1h 24m — nobody was ever prompted, and the gap surfaced only on the Unaccounted Time
  // report, where the cataloguer had no way to answer it.
  const lotMaxIdleRef      = useRef<{ startMs: number; ms: number } | null>(null)

  // Live timer display
  const [timerActive, setTimerActive] = useState(false)
  const [timerSecs,   setTimerSecs]   = useState(0)
  // Single threshold: the timer is teal until timerRedMins, then red — and the
  // same value is the idle threshold (one number, set per user in Admin → Users).
  const timerRedSecs    = timerRedMins    * 60

  // Step must be declared before the useEffect that depends on it
  const [step,        setStep]        = useState(1)

  const [vendor,      setVendor]      = useState("")
  const [tote,        setTote]        = useState("")
  const [receipt,     setReceipt]     = useState("")
  const [barcode,     setBarcode]     = useState("")

  // Load admin-configured reasons (falls back to defaults if unavailable)
  useEffect(() => {
    fetch("/api/admin/idle-timer-config")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.reasons?.length) setIdleReasons(d.reasons)
        if (typeof d?.message === "string") setIdleMessage(d.message)
      })
      .catch(() => { /* stay on defaults */ })
  }, [])

  // Seed the "lots today" badge from the DB so it shows the cataloguer's real
  // total for the UK working day — this survives coming off the app / reloading
  // (the old counter was in-memory and reset to 0 every time) and clears itself
  // at UK midnight. After seeding, each save bumps it locally as before.
  useEffect(() => {
    getMyLotsToday()
      .then(n => setLotCount(n))
      .catch(() => { /* leave at 0 if it can't load */ })
  }, [])

  useEffect(() => {
    if (!timerActive || !showLotTimer) return
    const id = setInterval(() => {
      setTimerSecs(lotTimerStartedAt.current ? Math.floor((Date.now() - lotTimerStartedAt.current) / 1000) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [timerActive, showLotTimer])

  // Idle detection — redesigned 2026-07-02. The popup NO LONGER fires on its own
  // while someone is away (the old 30-second watcher was intrusive and, when
  // ignored, stacked up against the next lot's timing). Instead the gap since
  // the last saved lot is checked at the moment a NEW LOT IS STARTED, and only
  // WORKING HOURS (Mon–Fri, 09:00–17:00 — see lib/idle-timer-config.ts) count
  // towards it. lastActivity persists to localStorage (per user) so closing the
  // page or going home doesn't lose it.
  const heartbeatKey = userId ? `${IDLE_HEARTBEAT_BASE}_${userId}` : IDLE_HEARTBEAT_BASE
  useEffect(() => {
    if (!showScanTimer) return
    // Restore last-activity from localStorage (survives page closes).
    try {
      const stored = Number(localStorage.getItem(heartbeatKey) || 0)
      if (stored > lastActivityRef.current) lastActivityRef.current = stored
    } catch { /* localStorage unavailable */ }
  }, [showScanTimer, heartbeatKey])

  function bumpActivity(ts: number) {
    lastActivityRef.current = ts
    try { localStorage.setItem(heartbeatKey, String(ts)) } catch {}
  }

  // Runs when a new lot's timing starts. Working-hours gap since the last saved
  // lot ≥ the user's red threshold → ask why. Before accusing anyone it asks the
  // server for the user's real last activity on ANY device (a save on the desktop
  // must not read as idle on the iPad — localStorage is per-device). A gap of 8+
  // working hours (a full working day — holiday / long absence) is skipped
  // silently, and someone with no history at all is never asked.
  async function checkIdleOnLotStart() {
    if (!showScanTimer || idlePopup) return
    try {
      // ⚠ event=lot-start also stamps the server's lot-start marker, which is what the
      // save-time gate measures the gap TO — so the minutes spent on this lot are not
      // counted as time away. Only this call may send it; see the route's note.
      const r = await fetch("/api/catalogue/last-activity?event=lot-start")
      if (r.ok) {
        const j = await r.json()
        const serverMs = Number(j?.lastMs) || 0
        if (serverMs > lastActivityRef.current) lastActivityRef.current = serverMs
        // The SERVER decides whether it's an over-threshold working-hours gap,
        // using the server clock + London working hours — so a changed phone
        // clock/timezone can't shrink it. Prompt with the server's own figure.
        if (j?.shouldPrompt && Number(j?.idleMs) > 0 && Number(j?.sinceMs) > 0) {
          raiseIdlePopup(Number(j.sinceMs), Number(j.idleMs))
          return
        }
        // Not idle per the server — advance the (server-anchored) baseline and stop.
        bumpActivity(Number(j?.serverNow) || Date.now())
        return
      }
    } catch { /* offline — fall through to the device-clock fallback below */ }

    // Offline fallback ONLY: measure with the device clock (best effort). The
    // server-side create-lot gate still backstops the save once back online.
    const now = Date.now()
    if (!lastActivityRef.current) { bumpActivity(now); return }
    const idleMs = workingMsBetween(lastActivityRef.current, now)
    if (idleMs >= EIGHT_WORK_HOURS_MS) { bumpActivity(now); return }
    if (idleMs >= timerRedSecs * 1000) raiseIdlePopup(lastActivityRef.current, idleMs)
    else bumpActivity(now)
  }

  // Shared popup opener for both idle checks.
  function raiseIdlePopup(startedAt: number, idleMs: number) {
    idleStartedAtRef.current = startedAt
    idleEndedAtRef.current   = Date.now()
    // The popup deals in WHOLE MINUTES (rounded up) — the header total, every
    // per-reason label and the split sliders must all use ONE consistent
    // whole-minute total. Storing the raw sub-minute seconds here made the slider
    // domain (e.g. a real 130s gap) disagree with the ceil'd "3m" label, so a
    // 2m-of-"3m" slice sat at ~92% of the bar instead of two-thirds, and the
    // leftover clamped to a ~10s remainder that still labelled as "1m". Rounding
    // up to the whole minute the labels already show makes value/total exact.
    setIdleSecs(Math.ceil(idleMs / 1000 / 60) * 60)
    setIdleSelected([])
    setIdleAlloc({})
    setIdleTotes("")
    setIdleNotesMap({})
    setIdleOtherWarn(false)
    setIdleUnallocWarn(false)
    setIdleError(null)
    setIdlePopup(true)
  }

  // ⚠ The two WITHIN-LOT checks below measure "how long since THIS PAGE was
  // last touched" — which is blind to the same person working in another tab
  // of the sale (the wizard stays mounted-hidden on tab switch), on another
  // device, or in the native camera. That produced a false "2h+ away" popup on
  // a second screen while the cataloguer was saving lots every few minutes on
  // her main one (Kathy, 2026-08-06 16:52 — no gate block, no idle log, and a
  // refresh cleared it because the measure lived in page memory). So, like
  // checkIdleOnLotStart already does, the local measure is now only a cheap
  // pre-filter for WHEN to ask — the SERVER decides whether the person was
  // genuinely away (working-hours gap since their last save on ANY device,
  // server clock, London hours) and the popup uses the server's figures.
  // Offline, the old device-local behaviour stands (better to over-ask than
  // let a gap slip; the create-lot gate still backstops the save).
  const serverGapRef   = useRef<{ sinceMs: number; idleMs: number } | null>(null)

  async function confirmIdleWithServer(): Promise<"prompt" | "fine" | "offline"> {
    try {
      const r = await fetch("/api/catalogue/last-activity")
      if (r.ok) {
        const j = await r.json()
        const serverMs = Number(j?.lastMs) || 0
        if (serverMs > lastActivityRef.current) lastActivityRef.current = serverMs
        if (j?.shouldPrompt && Number(j?.idleMs) > 0 && Number(j?.sinceMs) > 0) {
          serverGapRef.current = { sinceMs: Number(j.sinceMs), idleMs: Number(j.idleMs) }
          return "prompt"
        }
        return "fine"
      }
    } catch { /* offline */ }
    return "offline"
  }

  // Second idle check, added 2026-07-20 — runs when a lot is SAVED.
  //
  // checkIdleOnLotStart only fires on the first keystroke of a new barcode, and
  // barcodeStartedAt stays set for the rest of that lot. So starting a lot and
  // then walking away was never asked about: the gap was silently absorbed into
  // that lot's durationMs, and the next lot measured from the save, which was
  // recent. Scanning an item before going on a break is a natural thing to do,
  // so this was firing by accident as much as deliberately.
  //
  // Measures the same way as the other check — working hours only, and a full
  // working day or more is left alone.
  //
  // Returns true if the save must WAIT: either the popup opens (resumed by
  // submitIdleLog) or the server confirm comes back "fine" and resumes the
  // save itself. Since 2026-08-07 the popup only opens when the SERVER agrees
  // there's an unaccounted gap — see the note above confirmIdleWithServer.
  function maybePromptIdleBeforeSave(): boolean {
    if (!showScanTimer || idlePopup) return false
    if (!barcodeStartedAt.current) return false
    // The stretch running right now…
    const liveSince = lastInteractionRef.current || barcodeStartedAt.current
    const liveMs    = workingMsBetween(liveSince, Date.now())
    // …versus the longest one that happened EARLIER in this lot and has since been
    // touched away. Jordan, 2026-08-19: a lot worked on solidly for 45 minutes must
    // never ask, but one left sitting untouched must — so the trigger is inactivity,
    // not the lot's clock time.
    const best   = lotMaxIdleRef.current
    const useMax = !!best && best.ms > liveMs
    const since  = useMax ? best!.startMs : liveSince
    const idleMs = useMax ? best!.ms      : liveMs
    if (idleMs < timerRedSecs * 1000) return false
    if (idleMs >= EIGHT_WORK_HOURS_MS) return false
    pendingSaveRef.current  = true
    idleWithinLotRef.current = true
    void (async () => {
      const verdict = await confirmIdleWithServer()
      if (verdict === "fine") {
        // Active somewhere (another tab / device) — not away. Carry on saving.
        pendingSaveRef.current   = false
        idleWithinLotRef.current = false
        lastInteractionRef.current = Date.now()
        performSave()
        return
      }
      if (verdict === "prompt" && serverGapRef.current) {
        raiseIdlePopup(serverGapRef.current.sinceMs, serverGapRef.current.idleMs)
        return
      }
      raiseIdlePopup(since, idleMs)   // offline — device-local figures
    })()
    return true
  }

  // Any touch of the wizard while a lot is open — typing, tapping a step, picking
  // a category. Resets the idle clock; the gap is only ever measured from here.
  function noteInteraction() {
    if (!barcodeStartedAt.current) return
    rememberIdleStretch()
    lastInteractionRef.current = Date.now()
  }

  // Fold the stretch that has just ended into the lot's longest, BEFORE the clock is
  // reset. Every path that resets lastInteractionRef must call this first, or the
  // stretch it is about to erase is lost for good.
  function rememberIdleStretch() {
    const since = lastInteractionRef.current
    if (!since) return
    const ms = workingMsBetween(since, Date.now())
    // A full working day or more is a day off, not a walk-away — the same exclusion
    // the other checks make.
    if (ms < timerRedSecs * 1000 || ms >= EIGHT_WORK_HOURS_MS) return
    if (!lotMaxIdleRef.current || ms > lotMaxIdleRef.current.ms) {
      lotMaxIdleRef.current = { startMs: since, ms }
    }
  }

  // ⚠⚠ THE MID-LOT POPUP WAS REMOVED (Jordan, 2026-08-19): "I dont want it popping up mid
  // lot either at lot start or lot finish". checkWithinLotIdle used to raise the popup part
  // way through a lot, on typing or on coming back to the foreground. It now asks at the
  // two moments a lot has a natural boundary instead — checkIdleOnLotStart at the start,
  // maybePromptIdleBeforeSave at the save — and a walk-away in the middle is remembered by
  // rememberIdleStretch() and raised at the save.
  //
  // ⚠ Do NOT reinstate a check on TAPS to catch this: a tap can be the Save button, and
  // raising the popup from under a save swallows it. That was a deliberate exclusion, and
  // recording the stretch rather than raising it is what makes the tap harmless.
  //
  // ⚠ The server confirm is NOT lost with it: maybePromptIdleBeforeSave still calls
  // confirmIdleWithServer, so a cataloguer active in another tab, on another device or in
  // the native camera is still never accused of being away (the 2026-08-07 fix).

  // Coming back to the app after it was backgrounded / the screen was locked.
  useEffect(() => {
    if (!showScanTimer) return
    // Returning to the foreground ends the stretch — record it, don't raise anything.
    const onVisible = () => { if (document.visibilityState === "visible") noteInteraction() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  })

  // Single entry point for "a new lot has begun" — sets the activity/duration
  // baseline and runs the away check (async; the popup may appear a moment after
  // the field is focused). Called on barcode-field focus. Does NOT start the blue
  // lot timer — that is started by startLotTimerDisplay() once a barcode is
  // actually entered, so the timer never appears before the barcode does.
  function startLotTiming() {
    barcodeStartedAt.current   = Date.now()
    lastInteractionRef.current = Date.now()
    lotIdleAccumRef.current    = 0
    lotMaxIdleRef.current      = null
    void checkIdleOnLotStart()
  }

  // Starts the little blue count-up timer. Called when the barcode first gets a
  // value (typed / wedge-scanned / Next Barcode Number), never on bare focus.
  function startLotTimerDisplay() {
    if (!showLotTimer) return
    if (lotTimerStartedAt.current == null) lotTimerStartedAt.current = Date.now()
    setTimerActive(true)
  }

  // One selection = the whole gap. With several, each reason gets EXACTLY what
  // its slider was dragged to (starting at 0m, nothing ever auto-adjusts) and
  // whatever is left over becomes an UNALLOCATED segment — recorded as such.
  function idleSegments(): { reason: string; durationMs: number }[] {
    const totalMs = idleSecs * 1000
    if (idleSelected.length <= 1) return idleSelected.map(r => ({ reason: r, durationMs: totalMs }))
    const segs = idleSelected.map(k => ({ reason: k, durationMs: idleAlloc[k] ?? 0 }))
    const left = totalMs - segs.reduce((s, x) => s + x.durationMs, 0)
    if (left >= 1000) segs.push({ reason: "UNALLOCATED", durationMs: left })
    return segs
  }

  // A slider was dragged: set that reason to the chosen time, snapped to whole
  // minutes and hard-stopped at whatever is still unallocated (the final drag
  // may take the exact sub-minute remainder). No other slider ever moves.
  function setIdleSplit(key: string, rawMs: number) {
    const totalMs = idleSecs * 1000
    const others  = idleSelected.reduce((s, k) => (k === key ? s : s + (idleAlloc[k] ?? 0)), 0)
    // Same step the slider itself uses — see splitStepMs. Snapping to whole minutes here while
    // the slider stepped in seconds (or the reverse) would freeze the thumb.
    const step = splitStepMs(totalMs, idleSelected.length)
    const v = Math.max(0, Math.min(Math.round(rawMs / step) * step, totalMs - others))
    setIdleAlloc(a => ({ ...a, [key]: v }))
  }

  async function submitIdleLog() {
    if (idleSelected.length === 0) return
    setIdleSubmitting(true)
    setIdleError(null)
    // The reason MUST be recorded before we move on. A swallowed failure here is
    // an unlogged gap, which is exactly what this popup exists to prevent — so a
    // failure keeps the popup open rather than waving the user through. They lose
    // nothing by waiting: saving the lot needs the same server.
    try {
      const res = await fetch("/api/catalogue/idle-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId,
          idleStartedAt: new Date(idleStartedAtRef.current).toISOString(),
          idleDurationMs: idleSecs * 1000,
          // One entry per selected reason, splitting the gap by the sliders.
          segments: idleSegments().map(s => ({
            reason:      s.reason,
            durationMs:  s.durationMs,
            toteNumbers: s.reason === "LOTTING_UP" ? (idleTotes || null) : null,
            notes:       idleNotesMap[s.reason]?.trim() || null,
          })),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `Couldn't save (${res.status})`)
      }
    } catch (e: any) {
      setIdleError(e?.message ?? "Couldn't save that — check your connection and try again.")
      setIdleSubmitting(false)
      return
    }

    bumpActivity(Date.now())
    answeredGapRef.current = idleStartedAtRef.current
    const wasPendingSave = pendingSaveRef.current
    const wasWithinLot   = idleWithinLotRef.current
    pendingSaveRef.current   = false
    idleWithinLotRef.current = false
    lastInteractionRef.current = Date.now()
    setIdlePopup(false)
    setIdleSubmitting(false)

    if (wasWithinLot) {
      // The gap happened INSIDE this lot. Deliberately NOT deducted from the
      // lot's clock: a lot held up for two hours of research took two hours, and
      // durationMs must keep saying so. The idle is a SUBSET of the lot's time
      // (recorded separately in IdleLog), never an addition to it — so reporting
      // the two together can't double-count.
      lotIdleAccumRef.current += idleSecs * 1000
    }

    if (wasPendingSave) {
      // Raised by a save: the lot is finished and waiting on this answer.
      performSave()
      return
    }

    if (!wasWithinLot && barcodeStartedAt.current) {
      // Raised by starting a lot — the gap was before this lot began, so it isn't
      // deducted. Re-baseline so answering the popup doesn't inflate the lot.
      barcodeStartedAt.current = Date.now()
      setTimerSecs(0)
    }
  }

  // (The popup shows a FIXED duration now — the working-hours gap between the
  // last saved lot and starting this one. It no longer ticks while open,
  // because the gap it reports is already over by the time it appears.)

  // Track time spent on Key Points (step 3)
  useEffect(() => {
    if (step === 3) {
      keyPointsEnteredAt.current = Date.now()
    } else if (keyPointsEnteredAt.current !== null) {
      keyPointsAccumMs.current += Date.now() - keyPointsEnteredAt.current
      keyPointsEnteredAt.current = null
    }
  }, [step])

  const LAST_BARCODE_KEY = "vectis_last_barcode"
  function getLastBarcode() {
    try { return localStorage.getItem(LAST_BARCODE_KEY) ?? "" } catch { return "" }
  }
  function saveLastBarcode(val: string) {
    try { localStorage.setItem(LAST_BARCODE_KEY, val) } catch {}
  }

  // On first open, pre-fill Tote / Vendor / Receipt from the user's account so they survive
  // closing the app and follow the user across devices. Only fills blank fields, so it never
  // clobbers a pinned value or something the user has already started typing.
  // True while the trio on screen is the one carried over from last time rather than one chosen
  // for this batch. Cleared as soon as the tote is touched or the fields are cleared.
  const [restoredFromLast, setRestoredFromLast] = useState(false)
  // The "remember these numbers for this sale" write failed. Shown, not swallowed.
  const [rememberFailed,   setRememberFailed]   = useState(false)
  // ⚠ Notices a cataloguer has read and put away. Jordan, 2026-09-09: on a phone a warning they
  // cannot clear is in the way of the job all day. Cleared whenever the tote changes, so a NEW
  // batch always gets told again — dismissing is for this batch, never for good.
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const dismiss = (k: string) => setHidden(h => ({ ...h, [k]: true }))
  // ⚠⚠ The app was updated while this page was open, so its Save button is talking to a build the
  // server no longer has. Every other screen that hits this reloads itself; the wizard had NOTHING,
  // so the iPad showed Next's redacted "an error occurred" paragraph and kept failing until someone
  // reloaded it by hand. We do NOT auto-reload here: the lot on screen, including photos already
  // taken, would go with it. Say plainly what happened, that nothing was saved, and let them choose.
  const [staleDeploy,      setStaleDeploy]      = useState(false)

  // ⚠ These are remembered on the USER, not the sale, so they follow the person to a different
  // sale and a different iPad. Restoring them silently is how a batch gets catalogued under
  // yesterday's customer, so the banner says plainly that they were carried over until a tote is
  // actually chosen. The hintOnly lookup still labels them, and the warnings under Vendor/Receipt
  // compare the restored values against what BC says for that tote NOW.
  useEffect(() => {
    getLastLotFields(auctionId).then(f => {
      let filled = false
      setVendor(v => { if (!v && f.vendor) filled = true; return v || f.vendor })
      setTote(t => t || f.tote)
      setReceipt(r => r || f.receipt)
      if (f.tote) {
        setRestoredFromLast(filled || !!f.tote)
        lookupVendorFromBC({ tote: f.tote, hintOnly: true })   // labels + freshness only; never writes over the boxes
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [keyPoints,   setKeyPoints]   = useState("")
  // ⚠ Locked ON for a cataloguer who writes their own descriptions — the whole point is that
  // it cannot be left unticked. The server enforces it too (writesOwnDescriptions), so this is
  // only the visible half.
  const [aiExcluded,  setAiExcluded]  = useState(manualDescriptions)
  const [manualDesc,  setManualDesc]  = useState("")
  // Spell FLAGGING for Key Points / Description (step 3) — lists unrecognised words,
  // ignoring brand names + codes/numbers. See lib/spellcheck.ts.
  const [misspelled,  setMisspelled]  = useState<string[]>([])
  const brandTokens = useMemo(() => {
    const s = new Set<string>()
    for (const b of BRANDS_LIST) for (const p of b.toLowerCase().split(/[\s/&-]+/)) if (p.length > 1) s.add(p)
    return s
  }, [])
  useEffect(() => {
    const text = aiExcluded ? manualDesc : keyPoints
    if (step !== 3 || !text.trim()) { setMisspelled([]); return }
    let cancelled = false
    const id = setTimeout(async () => {
      const d = await loadSpellDict()
      if (!cancelled) setMisspelled(findMisspellings(text, d, brandTokens))
    }, 400)
    return () => { cancelled = true; clearTimeout(id) }
  }, [step, keyPoints, manualDesc, aiExcluded, brandTokens])
  const [mainCat,     setMainCat]     = useState("")
  const [subCat,      setSubCat]      = useState("")
  const [brand,       setBrand]       = useState("")
  const [estLow,      setEstLow]      = useState("")
  const [estHigh,     setEstHigh]     = useState("")
  const [cond1,       setCond1]       = useState("")
  const [cond2,       setCond2]       = useState("")
  // Optional separate box/packaging condition (step 6)
  const [boxOn,         setBoxOn]         = useState(false)
  const [boxPrefixMode, setBoxPrefixMode] = useState<BoxPrefixMode>("Box is")
  const [boxCustomPrefix, setBoxCustomPrefix] = useState("")
  const [boxCond1,      setBoxCond1]      = useState("")
  const [boxCond2,      setBoxCond2]      = useState("")
  const [parcel,      setParcel]      = useState("")
  const [photoFiles,  setPhotoFiles]  = useState<{ file: File; preview: string }[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Locked batch identity (tote / vendor / receipt) — set on "Start cataloguing",
  // carried across every lot until the cataloguer deliberately changes it (which
  // asks for confirmation). Replaces the old per-field Pin buttons.
  const [locked,        setLocked]        = useState<null | { tote: string; vendor: string; receipt: string; vendorName: string }>(null)
  const [changeConfirm, setChangeConfirm] = useState<null | { tote: string; vendor: string; receipt: string; vendorName: string }>(null)
  // Different tote asks first (Jordan, 2026-09-09). One tap used to empty the tote, vendor and
  // receipt and throw the batch back to step 1 with nothing to undo it.
  const [leaveToteConfirm, setLeaveToteConfirm] = useState(false)
  // ⚠⚠ The database is refusing writes (2026-09-09). Not a warning line — a STOP. Everything a
  // cataloguer does here is a write, so once one is refused the rest of the shift is refused too,
  // and the only useful thing the screen can do is say so and get them to put their pen down.
  const [dbReadOnly,    setDbReadOnly]    = useState(false)
  const [dbRecheck,     setDbRecheck]     = useState<"idle" | "checking" | "still" | "unknown">("idle")
  // Category/brand pins (separate feature — unchanged): keep a value sticky across lots.
  const [pinnedMain,    setPinnedMain]    = useState("")
  const [pinnedSub,     setPinnedSub]     = useState("")
  const [pinnedBrand,   setPinnedBrand]   = useState("")
  const [saveStatus,  setSaveStatus]  = useState("")
  const [lotCount,    setLotCount]    = useState(0)
  const [validErr,    setValidErr]    = useState("")
  const [toteInfo,      setToteInfo]      = useState<{ vendorNo: string; vendorName: string; receiptNo: string; location: string } | null>(null)
  const [toteResults,   setToteResults]   = useState<any[]>([])
  const [toteOpen,      setToteOpen]      = useState(false)
  const [toteIgnored,   setToteIgnored]   = useState(false)
  const [vendorHint,    setVendorHint]    = useState<string | null>(null)   // name hint from BC lookup

  // ── Which tote does `toteInfo` actually describe? ────────────────────────────
  // ⚠⚠ This exists to stop a hand correction being silently undone. `searchTotes` used to begin
  // `setToteInfo(null)`, and it runs on FOCUS as well as on change — so a bare tap into the tote
  // box and back out again (zero keystrokes) satisfied the old `!toteInfo` blur guard and re-ran
  // the BC lookup, overwriting whatever the cataloguer had just typed into Vendor/Receipt with the
  // cached values they were deliberately correcting. toteInfo is now cleared only where the tote
  // TEXT actually changes, and the blur only looks the tote up when it describes a different one.
  const [toteInfoFor,   setToteInfoFor]   = useState("")
  // ── What BC says is IN the tote ──────────────────────────────────────────────
  // The free text whoever booked the goods in typed on BC's Receipt Totes screen — "Tonka 4x Boxes
  // & 1x Tub", "Bears received 02.10.23", "green box". It is the one thing on this banner a
  // cataloguer can check against the box in front of them beyond the numbers, so it earns its line.
  // Blank for plenty of totes (BC does not require it) — the line simply doesn't render then.
  const [toteContents,  setToteContents]  = useState<string | null>(null)
  // Provenance of the BC answer, so an already-catalogued tote or a vendor guessed from an old item
  // shows amber rather than the same confident teal as a solid one.
  // ⚠ syncedAt is still carried but is NOT shown — Jordan, 2026-09-09: "the cataloguers dont need to
  // know that". Do not put the pulled-ago line back on this screen.
  const [toteMeta,      setToteMeta]      = useState<{ catalogued: boolean | null; syncedAt: string | null; source: string | null; knownTote?: boolean } | null>(null)
  // ⚠⚠ BC has this tote on MORE THAN ONE receipt. Nothing is filled in — the choice is shown and a
  // person picks. Guessing here is what put four correct lots onto the wrong receipt on F109.
  const [toteChoices,   setToteChoices]   = useState<{ receiptNo: string; vendorNo: string | null; vendorName: string | null; catalogued: boolean }[] | null>(null)
  // ⚠ Did a PERSON type this value, or did BC fill it in? Without this the app cannot tell a
  // cached guess from someone reading the paper docket, and every automatic refill silently wins.
  // Reset to false whenever the tote changes (which clears both fields anyway).
  const [vendorTyped,   setVendorTyped]   = useState(false)
  const [receiptTyped,  setReceiptTyped]  = useState(false)
  // Only the newest lookup may write. Cheap guard against a slow reply landing on a tote that has
  // since been changed.
  const lookupSeq = useRef(0)

  // (The "Resume an unfinished lot" draft feature — CatalogueLotDraft autosave
  // + banner, built 2026-07-31 — was REMOVED on Jordan's instruction 2026-08-07
  // ("it seems very buggy"). The table remains in the DB, inert. Don't rebuild
  // without discussing it.)

  // ⚠ No longer clears toteInfo. This runs on FOCUS too, and clearing the BC match just because
  // somebody tapped the box is what armed the blur lookup to undo their correction. The tote's
  // onChange clears it, which is the only place the tote can actually become a different tote.
  async function searchTotes(q: string) {
    const seq = ++lookupSeq.current
    if (!q.trim()) { setToteResults([]); setToteOpen(false); return }
    const res = await fetch(`/api/warehouse/tote-search?q=${encodeURIComponent(q)}`)
    if (!res.ok) return
    const data = await res.json()
    if (seq !== lookupSeq.current) return   // a newer keystroke has already answered
    setToteResults(data)
    setToteOpen(data.length > 0)
  }

  function selectTote(item: any) {
    lookupSeq.current++          // any in-flight lookup is now stale
    setTote(item.toteNo)
    setToteInfo(item)
    setToteInfoFor(item.toteNo)
    setToteContents(item.contents ?? null)
    setToteMeta({ catalogued: item.catalogued ?? null, syncedAt: item.syncedAt ?? null, source: "tote" })
    setToteResults([])
    setToteOpen(false)
    setToteIgnored(false)
    // Always overwrite vendor + receipt from the selected tote (the old "only if
    // blank" guard meant changing the tote kept the PREVIOUS vendor/receipt — the
    // mismatch bug this rework fixes). Picking a tote is a deliberate act, so it
    // outranks anything previously typed and resets the typed flags with it.
    setVendor(item.vendorNo ?? "")
    setVendorHint(item.vendorName ?? null)
    setReceipt(item.receiptNo ?? "")
    setVendorTyped(false)
    setReceiptTyped(false)
    setRestoredFromLast(false)
    setToteChoices(null)
    setHidden({})
  }

  // Look up vendor/receipt for a tote (or vendor for a receipt) from the BC-synced
  // warehouse. By default OVERWRITES vendor + receipt so changing the tote always
  // refreshes them. hintOnly fills just the name label (used when pre-filling the
  // remembered tote on open, where the values are already correct).
  async function lookupVendorFromBC(params: { receipt?: string; tote?: string; hintOnly?: boolean }) {
    const q = params.receipt
      ? `receipt=${encodeURIComponent(params.receipt)}`
      : `tote=${encodeURIComponent(params.tote ?? "")}`
    const seq = ++lookupSeq.current
    try {
      const res  = await fetch(`/api/warehouse/vendor-lookup?${q}`)
      const data = await res.json()
      // The tote may have been retyped while this was in flight — writing now would put one
      // tote's customer against another tote's number.
      if (seq !== lookupSeq.current) return
      // Set before the branches below, because every one of them returns: an ambiguous tote and a
      // bare shell row both still have BC's contents description, and both are exactly the cases
      // where knowing what is meant to be in the box helps most.
      if (params.tote) setToteContents(data.contents ?? null)
      // A tote BC knows about but has not put on a receipt yet (a Totes_Excel shell). Record it
      // so the screen can say exactly that, instead of the old empty " ()" label with the
      // "not found" warning suppressed — which told the cataloguer nothing at all.
      if (params.tote && data.ambiguous && Array.isArray(data.options) && data.options.length > 1) {
        setToteChoices(data.options)
        setToteInfo(null)
        setToteInfoFor(params.tote)
        setToteMeta({ catalogued: null, syncedAt: data.syncedAt ?? null, source: "receipt-tote" })
        // Deliberately leaves vendor/receipt exactly as they are rather than filling one in.
        return
      }
      if (params.tote && data.source === "tote-shell") {
        setToteMeta({ catalogued: null, syncedAt: null, source: "tote-shell", knownTote: true })
        setToteInfoFor(params.tote)
        return
      }
      if (data.vendorNo) {
        setToteChoices(null)
        setVendorHint(data.vendorName ?? null)
        // A tote that resolves in BC is "found" — record it so the false
        // "Tote not found in BC warehouse" warning doesn't show (incl. on prefill).
        if (params.tote) {
          setToteInfo({ vendorNo: data.vendorNo, vendorName: data.vendorName ?? "", receiptNo: data.receiptNo ?? "", location: data.location ?? "" })
          setToteInfoFor(params.tote)
        }
        setToteMeta({ catalogued: data.catalogued ?? null, syncedAt: data.syncedAt ?? null, source: data.source ?? null })
        if (!params.hintOnly) {
          // ⚠ Never overwrite a value a PERSON typed. They are usually reading the paper docket,
          // and the cached row they are correcting is exactly what would be written back here.
          if (!vendorTyped) setVendor(data.vendorNo)
          if (data.receiptNo && !receiptTyped) setReceipt(data.receiptNo)
        }
      }
    } catch { /* silent — lookup is best-effort */ }
  }

  const categoryMap = useCategoryMap()
  const subCats     = mainCat ? (categoryMap[mainCat] ?? []) : []
  const mainCatList = Object.keys(categoryMap)
  const boxWordings = useConditionWordings()
  const inpFocus    = tablet
    ? "w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3.5 text-base text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6]"
    : "w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6] desk:py-2.5 desk:text-base"
  const lbl = tablet
    ? "text-sm text-gray-600 dark:text-gray-400 uppercase tracking-wider"
    : "text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider"

  function validateStep(s: number): string {
    if (s === 1) {
      if (!vendor.trim())  return "Vendor Number is required"
      if (!tote.trim())    return "Tote Number is required"
      if (!receipt.trim()) return "Receipt Number is required"
    }
    if (s === 2 && !barcode.trim()) return "Internal Barcode is required"
    if (s === 5) {
      if (!estLow.trim() || !estHigh.trim()) return "Both Estimate Low and High are required"
      if (isNaN(Number(estLow.replace(/[£,]/g, ""))) || isNaN(Number(estHigh.replace(/[£,]/g, ""))))
        return "Estimate values must be numbers"
    }
    if (s === 7 && !parcel.trim()) return "Parcel Size is required"
    return ""
  }

  // ── "Start cataloguing" — lock the tote/vendor/receipt in for the batch ──────
  // Commit the current (or a confirmed) identity and advance to the barcode step.
  function commitStart(id?: { tote: string; vendor: string; receipt: string; vendorName: string }) {
    const next = id ?? { tote: tote.trim(), vendor: vendor.trim(), receipt: receipt.trim(), vendorName: vendorHint ?? toteInfo?.vendorName ?? "" }
    setLocked(next)
    setChangeConfirm(null)
    setStep1LengthWarning(false)
    setValidErr("")
    setStep(2)
  }
  // After validation + the 7-char gate: if this switches away from an already-locked
  // vendor, ask "are you sure?" first; otherwise commit straight away.
  function afterStartChecks() {
    const cur = { tote: tote.trim(), vendor: vendor.trim(), receipt: receipt.trim(), vendorName: vendorHint ?? toteInfo?.vendorName ?? "" }
    const changed = !!locked && (locked.tote !== cur.tote || locked.vendor !== cur.vendor || locked.receipt !== cur.receipt)
    if (changed) setChangeConfirm(cur)
    else commitStart(cur)
  }
  function startCataloguing() {
    const err = validateStep(1)
    if (err) { setValidErr(err); return }
    setValidErr("")
    // Length AND shape. All three are always 7 characters in a fixed form, so a wrong leading
    // letter is as certainly an error as a short entry — and it is the one that catches a receipt
    // number typed into the Vendor box, which passed every gate before.
    if (checkIdentityTrio({ tote, vendor, receipt }).length > 0) { setStep1LengthWarning(true); return }   // its "Continue anyway" resumes via afterStartChecks
    afterStartChecks()
  }
  // Empty the tote/vendor/receipt trio and everything derived from them (the BC
  // tote match, the vendor name hint, the "use anyway" override, the warnings).
  // ⚠ Shared by the step-1 "Clear vendor details" button and "Change Tote /
  // Vendor" so the two can't drift — a half-cleared form is how a lot ends up
  // saved against the previous vendor.
  // `locked` is deliberately NOT cleared: switching batch must still go through
  // the confirmation, which needs to show what you're moving away from.
  function clearVendorFields() {
    lookupSeq.current++
    setTote(""); setVendor(""); setReceipt("")
    setToteInfo(null); setToteResults([]); setToteOpen(false); setToteIgnored(false); setVendorHint(null)
    setToteContents(null)
    setToteInfoFor(""); setToteMeta(null); setVendorTyped(false); setReceiptTyped(false)
    setRestoredFromLast(false); setToteChoices(null); setRememberFailed(false); setHidden({})
    setStep1LengthWarning(false); setValidErr("")
  }

  // "Change Tote / Vendor" — wipe the trio for a clean re-entry, then go back to
  // step 1.
  // Ask the server whether the database is taking writes again. ⚠ Only ever called while the
  // stop is already on screen — nothing polls this in the normal case. An error answers "unknown"
  // rather than "still refusing": a dropped connection is a different fact, and telling somebody
  // their database is still down because the wifi blipped sends them home for nothing.
  async function recheckDbWritable() {
    setDbRecheck("checking")
    try {
      const res  = await fetch("/api/health/db-writable", { cache: "no-store" })
      const data = await res.json()
      if (data?.writable === true) {
        setDbReadOnly(false)
        setDbRecheck("idle")
        setSaveStatus("The database is taking saves again \u2014 press Save Lot to save this one.")
        return
      }
      setDbRecheck(data?.writable === false ? "still" : "unknown")
    } catch {
      setDbRecheck("unknown")
    }
  }

  function changeVendor() {
    setLeaveToteConfirm(false)
    clearVendorFields()
    // Stop the blue lot timer while back on the Vendor & Tote step — there's no
    // barcode being catalogued here, so it shouldn't be counting.
    lotTimerStartedAt.current = null
    setTimerActive(false)
    setTimerSecs(0)
    setStep(1)
  }

  async function goNext() {
    const err = validateStep(step)
    if (err) { setValidErr(err); return }
    setValidErr("")
    // Warn if Tote/Vendor/Receipt aren't exactly 7 characters
    if (step === 1) {
      if (checkIdentityTrio({ tote, vendor, receipt }).length > 0) {
        setStep1LengthWarning(true)
        return
      }
    }
    // Is this barcode already assigned to a lot anywhere in the app? A live
    // server check, so it sees lots created seconds ago on another device.
    // Checked before the prefix warning below: an exact match against a real
    // lot is a fact, where the prefix check is only a heuristic.
    if (step === 2 && barcode.trim()) {
      setCheckingBarcode(true)
      const res = await checkBarcodeAssigned(barcode.trim())
      setCheckingBarcode(false)
      if (!res.ok) { setDupeCheckError(res.error ?? "Could not check the barcode"); return }
      if (res.taken) { setDupeWarning(res.taken); return }
    }
    // Warn if barcode prefix doesn't match auction code
    if (step === 2 && barcode.trim()) {
      const code = auction.code.toUpperCase()
      if (!barcode.trim().toUpperCase().startsWith(code)) {
        setBarcodeWarning(true)
        return
      }
    }
    // Warn if a hand-typed category doesn't match the preset list (mirrors BC —
    // a non-preset value won't match up when the sale is pushed to BC). Main is
    // checked first: the sub-category list depends on a valid main.
    if (step === 4) {
      if (mainCat.trim() && !mainCatList.includes(mainCat.trim())) {
        setCategoryWarning("main")
        return
      }
      if (subCat.trim() && !subCats.includes(subCat.trim())) {
        setCategoryWarning("sub")
        return
      }
    }
    // Warn if Estimate Low is above Estimate High (values already validated numeric).
    if (step === 5) {
      const lo = Number(estLow.replace(/[£,]/g, ""))
      const hi = Number(estHigh.replace(/[£,]/g, ""))
      if (lo > hi) {
        setEstimateWarning(true)
        return
      }
    }
    if (step < 8) setStep(step + 1)
  }

  function goBack() {
    jumpBack(step - 1)
  }

  /** Back to any step already done — the ← Back button, and "This lot so far" on a desktop.
   *  ⚠ BACKWARDS ONLY: forward is always through Next, so its checks (the duplicate barcode, the
   *  category and estimate warnings) can never be skipped by jumping. */
  function jumpBack(to: number) {
    setValidErr("")
    setCategoryWarning(null)
    setEstimateWarning(false)
    setBarcodeWarning(false)        // else the top-nav button stays disabled back on step 1
    setDupeWarning(null)
    setDupeCheckError(null)
    setStep1LengthWarning(false)
    if (to >= 1 && to < step) setStep(to)
  }

  function nextBarcodeNumber() {
    const src = barcode || getLastBarcode()
    if (!src) return
    const m = src.match(/(\d+)$/)
    if (!m) return
    if (!barcodeStartedAt.current) startLotTiming()
    startLotTimerDisplay()
    setBarcode(src.slice(0, m.index) + String(parseInt(m[1]) + 1).padStart(m[1].length, "0"))
  }

  // Build the saved condition via the shared helper (item condition + optional separate
  // box/packaging sentence) so the wizard, desktop editor and tablet stay in lock-step.
  function buildCondition(): string {
    return buildConditionStr({ cond1, cond2, boxOn, boxPrefixMode, boxCustomPrefix, boxCond1, boxCond2 })
  }

  function saveLot(e?: { isTrusted?: boolean; detail?: number; nativeEvent?: unknown }) {
    // Diagnostic (non-blocking, fire-and-forget): record WHAT activated Save — a
    // genuine touch vs a synthetic/keyboard event — plus whether the lot was
    // actually filled in. Lets us identify the external activator on X069.
    try {
      const pointerType = (e?.nativeEvent as { pointerType?: string } | undefined)?.pointerType ?? null
      const nav = typeof navigator !== "undefined" ? navigator : undefined
      fetch("/api/catalogue/save-attempt", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({
          auctionId, auctionCode: auction.code, step, pointerType,
          isTrusted: e?.isTrusted ?? null,
          detail: e?.detail ?? null,
          barcode: barcode.trim() || null,
          hasBarcode: !!barcode.trim(),
          hasEstimate: !!estLow.trim() && !!estHigh.trim(),
          hasParcel: !!parcel.trim(),
          userAgent: nav?.userAgent ?? null,
          touchPoints: typeof nav?.maxTouchPoints === "number" ? nav.maxTouchPoints : null,
        }),
      }).catch(() => {})
    } catch { /* diagnostic only — never block a save */ }

    // Nothing gets written while an idle prompt is unanswered. The popup covers
    // the screen, so a save arriving here is a stray/synthetic activation (see
    // the X069 diagnostic above) — it must not sneak a lot past the prompt.
    if (idlePopup) return

    // Validate the WHOLE wizard, not just the current step. Step 8's Save had no
    // validation, so any activation of it minted a lot from whatever was on
    // screen — this is what was auto-creating blank lots.
    for (const s of [1, 2, 5, 7]) {
      const v = validateStep(s)
      if (v) { setValidErr(v); setStep(s); return }
    }
    // Refuse to re-save the same barcode, or to save twice in quick succession —
    // stops a stuck / continuous-mode scanner minting duplicate lots.
    if (barcode.trim() && barcode.trim() === lastSavedBarcode.current) {
      setValidErr("That barcode was just saved — scan the next item."); return
    }
    if (Date.now() - lastSavedAt.current < 3000) return
    setValidErr("")

    // Did they start this lot and then walk away? Ask before the lot is written —
    // performSave() runs from submitIdleLog once the reason is logged.
    if (maybePromptIdleBeforeSave()) return

    performSave()
  }

  // The actual write. Split out of saveLot so the idle popup can interrupt a save
  // and resume it afterwards; every guard and validation lives in saveLot.
  function performSave() {
    const condition = buildCondition()
    const autoTitle = [brand, mainCat, subCat].filter(Boolean).join(" – ") || barcode || "Lot"
    const title = aiExcluded
      ? (manualDesc.split("\n")[0]?.trim() || autoTitle)
      : (keyPoints.split("\n")[0]?.trim() || autoTitle)

    const fd = new FormData()
    fd.append("barcode",      barcode)
    fd.append("title",        title)
    fd.append("keyPoints",    aiExcluded ? "" : keyPoints)
    fd.append("description",  aiExcluded ? manualDesc : "")
    fd.append("aiExcluded",   String(aiExcluded))
    fd.append("estimateLow",  estLow.replace(/[£,]/g, "").trim())
    fd.append("estimateHigh", estHigh.replace(/[£,]/g, "").trim())
    fd.append("condition",    condition)
    fd.append("vendor",       vendor)
    fd.append("tote",         tote)
    fd.append("receipt",      receipt)
    fd.append("category",     mainCat)
    fd.append("subCategory",  subCat)
    fd.append("brand",        brand)
    fd.append("notes",        parcel)
    fd.append("status",       "ENTERED")
    // Flush key points time if still on that step (shouldn't be, but safety net)
    if (keyPointsEnteredAt.current !== null) {
      keyPointsAccumMs.current += Date.now() - keyPointsEnteredAt.current
      keyPointsEnteredAt.current = null
    }
    fd.append("durationMs",   String(barcodeStartedAt.current ? Date.now() - barcodeStartedAt.current : 0))
    fd.append("keyPointsMs",  String(keyPointsAccumMs.current))
    // What the DEVICE clock/timezone claims at save — the server logs this next to
    // its own real time, exposing a phone set to a US timezone / odd hour to dodge
    // the 9–5 check. Purely for the audit; the gate itself ignores these.
    fd.append("clientNow",    String(Date.now()))
    try { fd.append("clientTz", Intl.DateTimeFormat().resolvedOptions().timeZone || "") } catch { /* older browser */ }
    photoFiles.forEach(p => fd.append("photo", p.file))

    start(async () => {
      let res: unknown
      try {
        res = await createLot(auctionId, fd)
      } catch (e: any) {
        const info = describeActionError(e)
        if (info.staleDeploy) { setStaleDeploy(true); setSaveStatus("") ; return }
        setSaveStatus(`⚠ ${info.message}${info.digest ? ` (ref ${info.digest})` : ""}`)
        return
      }
      // Server idle gate: this lot won't be created until the working-hours gap
      // since the last save is accounted for. Reuse the existing popup — logging
      // the reason re-runs performSave, which then passes (a covering log exists).
      // Enforced server-side so it survives closing the app / signing out.
      // The database is refusing writes. The lot on screen is NOT saved and nothing further will
      // be, so stop the batch rather than letting them carry on into a wall.
      if (isDbReadOnlyBlock(res)) { setDbReadOnly(true); setDbRecheck("idle"); setSaveStatus(""); return }
      if (res && typeof res === "object" && (res as { needsIdle?: boolean }).needsIdle) {
        const g = res as { idleMs: number; sinceMs: number }
        // ⚠ Only ask ONCE per gap. The server gate excludes UNALLOCATED rows and wants half the
        // gap covered, so someone who honestly leaves time unallocated used to get the same
        // popup again — and each pass wrote another set of rows starting at the same instant,
        // overlapping the first and inflating their figures. Allocating only the minimum never
        // converged, so the lot could not be saved at all. Their answer now stands; unallocated
        // time still shows in the reports, so nothing is hidden.
        if (answeredGapRef.current !== g.sinceMs) {
          pendingSaveRef.current   = true
          idleWithinLotRef.current = false
          raiseIdlePopup(g.sinceMs, g.idleMs)
          return
        }
      }
      barcodeStartedAt.current = null
      lotTimerStartedAt.current = null
      keyPointsAccumMs.current = 0
      keyPointsEnteredAt.current = null
      bumpActivity(Date.now())
      setTimerActive(false)
      setTimerSecs(0)
      const n = lotCount + 1
      setLotCount(n)
      lastSavedBarcode.current = barcode.trim()
      lastSavedAt.current = Date.now()
      saveLastBarcode(barcode)
      // Remember Tote / Vendor / Receipt on the user's account for next time (any device)
      // ⚠ Was fire-and-forget with `.catch(() => {})`. When it failed — a stale deploy, a dropped
      // connection, a backgrounded iPad tab — nothing was recorded and the next visit restored
      // older numbers with no sign anything had gone wrong. Scoped to THIS sale now, and a failure
      // says so on screen instead of vanishing.
      saveLastLotFields({ vendor, tote, receipt, auctionId })
        .then(r => {
          // ⚠ A read-only database is not "could not remember these numbers" — it is the same
          // stop as a refused lot. This write failing is what made vendors appear to revert.
          if (r && (r as { dbReadOnly?: boolean }).dbReadOnly) { setDbReadOnly(true); setDbRecheck("idle"); return }
          if (!r?.ok) setRememberFailed(true)
        })
        .catch(() => setRememberFailed(true))
      setSaveStatus(`✓ Lot #${n} saved — ${vendor} / ${tote} / ${barcode}`)
      // Tote / Vendor / Receipt stay locked for the whole batch — leave them (and the
      // vendor name hint) as-is so the next lot keeps the same identity.
      setBarcode(""); setKeyPoints(""); setAiExcluded(false); setManualDesc("")
      setMainCat(pinnedMain); setSubCat(pinnedSub); setBrand(pinnedBrand)
      setEstLow(""); setEstHigh(""); setCond1(""); setCond2(""); setParcel("")
      setBoxOn(false); setBoxPrefixMode("Box is"); setBoxCustomPrefix(""); setBoxCond1(""); setBoxCond2("")
      photoFiles.forEach(p => URL.revokeObjectURL(p.preview))
      setPhotoFiles([])
      setStep(2)
      onCreated()
    })
  }

  // A notice a cataloguer can put away. 44px target — these live on the iPads.
  function Dismiss({ k }: { k: string }) {
    return (
      <button type="button" onClick={() => dismiss(k)} aria-label="Hide this message"
        style={{ touchAction: tablet ? "manipulation" : undefined, minWidth: 44, minHeight: 44 }}
        className="flex-shrink-0 -my-2 -mr-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-lg leading-none">
        ✕
      </button>
    )
  }

  // Whole minutes, ROUNDED UP — the popup deliberately shows no seconds
  // (Jordan 2026-07-23: "remove the seconds and just round up").
  function fmtIdleDuration(secs: number) {
    if (secs <= 0) return "0m"
    const mins = Math.max(1, Math.ceil(secs / 60))
    const h = Math.floor(mins / 60), m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  // The "from … to …" gap window. HH:MM each end, but when the gap crosses
  // midnight (an early finish yesterday + a late start today) each side gets its
  // weekday so it doesn't read as a same-day window.
  function fmtGapWindow(startMs: number, endMs: number) {
    const t = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short" })
    const sameDay = new Date(startMs).toDateString() === new Date(endMs).toDateString()
    return sameDay ? `${t(startMs)} – ${t(endMs)}` : `${day(startMs)} ${t(startMs)} – ${day(endMs)} ${t(endMs)}`
  }

  return (
    // Capture-phase so every control inside counts as activity without having to wire
    // each one. All three do the same thing now: end the current inactive stretch,
    // remember it if it is this lot's longest, and reset the clock. None of them can
    // raise the popup — that happens only at lot start and at save.
    <div className="flex flex-col h-full"
      onPointerDownCapture={noteInteraction}
      onChangeCapture={noteInteraction}
      onKeyDownCapture={noteInteraction}>

      {/* ── Idle popup ──────────────────────────────────────────────────────── */}
      {idlePopup && (() => {
        const segs   = idleSegments()
        const segMs  = new Map(segs.map(s => [s.reason, s.durationMs]))
        const multi  = idleSelected.length > 1
        const totalGapMs = idleSecs * 1000
        // Whole minutes when they fit, finer when they can't go round — see splitStepMs.
        const sliderStep = splitStepMs(totalGapMs, idleSelected.length)
        const unallocMs  = multi ? (segMs.get("UNALLOCATED") ?? 0) : 0
        // Every selected reason needs SOME time on its slider before submitting.
        const allocMissing = multi && idleSelected.some(k => (idleAlloc[k] ?? 0) < 1000)
        // A note is missing when a selected reason requires one (or lunch ran over
        // an hour of ITS OWN allocated time) and nothing has been typed for it.
        const missingNote = (k: string) => {
          const cfg = idleReasons.find(r => r.key === k)
          // Lunch has an EXTRA rule — over an hour of its own allocated time always needs
          // explaining. It used to REPLACE the admin's "requires a note" tick, which meant
          // ticking that box on Lunch Break silently did nothing (Jordan: "why is lunch
          // special it should just work the same as the rest"). Both now apply.
          const longLunch = k === "LUNCH_BREAK" && (segMs.get(k) ?? 0) > 65 * 60 * 1000
          const needed    = longLunch || !!cfg?.requiresNotes
          return needed && !idleNotesMap[k]?.trim()
        }
        const anyMissing = idleSelected.some(missingNote)
        const setNote = (k: string, v: string) => setIdleNotesMap(m => ({ ...m, [k]: v }))
        return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto">
            <div className="text-center mb-5">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-600 mb-1">How was this time spent?</p>
              <p className="text-5xl font-mono font-bold text-gray-900">{fmtIdleDuration(idleSecs)}</p>
              {idleStartedAtRef.current > 0 && (
                <p className="text-sm font-semibold text-gray-700 mt-1.5">
                  {fmtGapWindow(idleStartedAtRef.current, idleEndedAtRef.current)}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                {idleWithinLotRef.current
                  ? "since you last touched this lot — working hours (Mon–Fri, 9–5) only"
                  : "since your last saved lot — working hours (Mon–Fri, 9–5) only"}
              </p>
            </div>

            {/* Optional note from Admin → Activity Timer. Blank = nothing rendered. */}
            <IdleMessageBanner message={idleMessage} />

            {/* Reason buttons — loaded from admin config, grouped and colour-coded by the
                SHARED picker so this and the admin preview can never drift apart again. */}
            <IdleReasonPicker
              reasons={idleReasons}
              selected={idleSelected}
              onToggle={(key, on) => {
                // Selecting "Other" goes via the reminder first; deselecting is instant.
                if (!on && key === "OTHER") { setIdleOtherWarn(true); return }
                setIdleSelected(sel => on ? sel.filter(k => k !== key) : [...sel, key])
                // ⚠ Drop the allocation too. Without this a deselected reason keeps its minutes
                // and hands them back if it is re-selected, so the segments can total MORE than
                // the gap — and the leftover guard below (left >= 1000) hides the overflow, so
                // "Not allocated" reads 0m and Save stays enabled. The extra minutes are then
                // written past the end of the gap, over time actually spent working.
                if (on) setIdleAlloc(a => { const { [key]: _drop, ...rest } = a; return rest })
              }}
            />
            <p className="text-[11px] text-gray-400 text-center mb-3">Doing more than one thing? Tap all that apply.</p>

            {/* Split sliders — only when more than one reason is picked */}
            {multi && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-700">Split the time between them</p>
                <p className="text-[11px] text-gray-500 mb-2.5">A rough estimate is absolutely fine — it doesn&apos;t need to be exact.</p>
                <div className="space-y-2.5">
                  {idleSelected.map(key => {
                    const cfg = idleReasons.find(r => r.key === key)
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="font-semibold text-gray-700">{cfg?.icon} {cfg?.label ?? key}</span>
                          <span className="font-mono font-bold text-[#1a8a80]">{fmtIdleDuration(Math.round((idleAlloc[key] ?? 0) / 1000))}</span>
                        </div>
                        <input type="range" min={0} max={totalGapMs} step={sliderStep}
                          value={idleAlloc[key] ?? 0}
                          onChange={e => setIdleSplit(key, Number(e.target.value))}
                          className="idle-slider" />
                      </div>
                    )
                  })}
                </div>
                {/* Whatever isn't given to a reason is recorded as unallocated */}
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-200 text-xs">
                  <span className="font-semibold text-gray-500">❔ Not allocated</span>
                  <span className={`font-mono font-bold ${unallocMs >= 1000 ? "text-amber-600" : "text-gray-400"}`}>
                    {fmtIdleDuration(Math.round(unallocMs / 1000))}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Anything left over is recorded as unallocated time.</p>
                {allocMissing && (
                  <p className="text-[11px] text-red-500 mt-1">Give each selected activity some time using its slider.</p>
                )}
              </div>
            )}

            {/* Lotting Up — tote numbers field (always shown for this reason) */}
            {idleSelected.includes("LOTTING_UP") && (
              <div className="space-y-2 mb-4">
                <input value={idleTotes} onChange={e => setIdleTotes(e.target.value)}
                  placeholder="Tote numbers (e.g. F001, F002)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2AB4A6]" />
              </div>
            )}

            {/* Lunch Break — mandatory note if ITS share is over 65 minutes */}
            {idleSelected.includes("LUNCH_BREAK") && (segMs.get("LUNCH_BREAK") ?? 0) > 65 * 60 * 1000 && (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">
                  ⚠️ Lunch break over 1 hour — reason for exceeding time
                </p>
                <textarea value={idleNotesMap["LUNCH_BREAK"] ?? ""} onChange={e => setNote("LUNCH_BREAK", e.target.value)}
                  placeholder="Reason for exceeding 1 hour…"
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none transition-colors ${
                    idleNotesMap["LUNCH_BREAK"]?.trim() ? "border-amber-200 bg-white focus:border-[#2AB4A6]" : "border-red-300 bg-white focus:border-red-400"
                  }`}
                  rows={2} />
                {!idleNotesMap["LUNCH_BREAK"]?.trim() && (
                  <p className="text-xs text-red-500 mt-1">A reason is required before you can continue.</p>
                )}
              </div>
            )}

            {/* Note / follow-up question — one per selected reason that requires a
                note OR carries a custom follow-up question (notePrompt). */}
            {idleSelected.map(key => {
              if (key === "LUNCH_BREAK") return null
              const cfg = idleReasons.find(r => r.key === key)
              const prompt   = cfg?.notePrompt?.trim()
              const required = !!cfg?.requiresNotes
              if (!required && !prompt) return null
              const missing = required && !idleNotesMap[key]?.trim()
              return (
                <div key={key} className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    {multi ? `${cfg?.icon} ${cfg?.label} — ` : ""}{prompt || "Note"}
                    {required && <> <span className="text-red-500">*</span><span className="font-normal text-gray-400 ml-1">required</span></>}
                  </label>
                  <textarea value={idleNotesMap[key] ?? ""} onChange={e => setNote(key, e.target.value)}
                    placeholder={prompt ? `${prompt}…` : "Please explain what you were doing…"}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none resize-none transition-colors ${
                      missing ? "border-red-300 bg-red-50 focus:border-red-400" : "border-gray-200 focus:border-[#2AB4A6]"
                    }`}
                    rows={multi ? 2 : 3} />
                  {missing && (
                    <p className="text-xs text-red-500 mt-1">An answer is required before you can continue.</p>
                  )}
                </div>
              )
            })}

            {idleError && (
              <div className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700 mb-0.5">⚠️ {idleError}</p>
                <p className="text-xs text-red-600">
                  Nothing has been lost — your lot is still here. Check the connection and try again.
                </p>
              </div>
            )}

            <button onClick={() => { if (unallocMs >= 60_000) setIdleUnallocWarn(true); else void submitIdleLog() }}
              disabled={idleSelected.length === 0 || idleSubmitting || anyMissing || allocMissing}
              className="w-full py-3 bg-[#2AB4A6] hover:bg-[#22a090] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors">
              {idleSubmitting ? "Saving…" : idleError ? "Try Again" : pendingSaveRef.current ? "Log & Save Lot" : "Log & Continue"}
            </button>
          </div>

          {/* "Other" reminder — pick a listed option if one fits */}
          {idleOtherWarn && (
            <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-1.5">⚠️ Before you pick Other…</p>
                <p className="text-sm text-gray-600 mb-4">
                  Only use Other when none of the options above cover what you were doing.
                  If there&apos;s an option for it, please pick that one instead.
                </p>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => setIdleOtherWarn(false)}
                    className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-sm font-bold rounded-xl transition-colors">
                    ← I&apos;ll pick an option instead
                  </button>
                  <button type="button"
                    onClick={() => { setIdleSelected(sel => sel.includes("OTHER") ? sel : [...sel, "OTHER"]); setIdleOtherWarn(false) }}
                    className="w-full py-2.5 border-2 border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
                    None of them fit — use Other
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Unallocated-time warning — shown when they submit with time left over */}
          {idleUnallocWarn && (
            <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-1.5">⚠️ You have unallocated time</p>
                <p className="text-sm text-gray-600 mb-4">
                  <span className="font-bold text-amber-600">{fmtIdleDuration(Math.round(unallocMs / 1000))}</span> of
                  this time hasn&apos;t been given to an activity. You can go back and share it out using the sliders,
                  or continue and it will be recorded as unallocated time.
                </p>
                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => setIdleUnallocWarn(false)}
                    className="w-full py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-sm font-bold rounded-xl transition-colors">
                    ← Go back and allocate it
                  </button>
                  <button type="button"
                    onClick={() => { setIdleUnallocWarn(false); void submitIdleLog() }}
                    className="w-full py-2.5 border-2 border-gray-200 hover:border-gray-300 text-gray-600 text-sm font-semibold rounded-xl transition-colors">
                    Continue anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )
      })()}

      {/* ⚠⚠ THE DATABASE IS REFUSING WRITES — A FULL STOP, NOT A BANNER (2026-09-09).
          Production’s database came up read-only for an hour. Reads worked, so the app looked
          perfectly healthy, and cataloguers carried on for an hour losing every lot — seeing one
          refused save at a time, worded as Next’s "the specific message is omitted in production
          builds" boilerplate, plus their tote and vendor quietly reverting (that is a write too,
          and it was failing as well).
          It is a MODAL and it cannot be clicked away, because the only correct action is to stop.
          A banner would have been scrolled past — and the banners on this screen now sit at the
          foot of the step, where it would not even have been on screen.
          ⚠ It says the lot is still on screen: the danger otherwise is somebody assuming the work
          is gone and clearing the form, which is the one way to actually lose it. */}
      {dbReadOnly && (
        <div className="fixed inset-0 z-[95] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border-2 border-red-500 w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Stop — nothing is saving</h3>
            <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">{DB_READ_ONLY_MESSAGE}</p>
            <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
              <strong>This lot was not saved.</strong> It is still on the screen behind this message, so
              don&apos;t clear anything — when the database is back, press Save Lot and it will go in.
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
              Nothing already saved is affected. This is the database refusing new entries, not the app.
            </p>
            {dbRecheck === "still" && (
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">Still not accepting anything. Leave it a few minutes and press again.</p>
            )}
            {dbRecheck === "unknown" && (
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">Could not reach the server to ask — that may just be the connection. Try again in a moment.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={recheckDbWritable} disabled={dbRecheck === "checking"}
                style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
                className={`font-semibold rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
                {dbRecheck === "checking" ? "Checking…" : "Check again"}
              </button>
              <button type="button" onClick={() => window.location.reload()}
                style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
                className={`font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
                Reload the page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Different tote — ask before emptying the batch's identity.
          ⚠ Buttons are deliberately the other way round from a normal dialog: the safe one is on
          the right, under the thumb, because this is reached by ACCIDENT more often than on
          purpose. Tapping the backdrop cancels too. */}
      {leaveToteConfirm && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={() => setLeaveToteConfirm(false)}>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Start a different tote?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              This clears the tote, vendor and receipt and takes you back to step 1. Any lot you are part-way
              through is not saved.
            </p>
            <div className="rounded-xl bg-gray-100 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm space-y-1 mb-4">
              <div className="text-gray-500">You are on:</div>
              <div><span className="text-gray-500">Customer </span><span className="text-gray-800 dark:text-gray-100">{vendorHint || toteInfo?.vendorName || "not known"}</span></div>
              <div><span className="text-gray-500">Tote </span><span className="font-mono text-gray-800 dark:text-gray-100">{tote || "—"}</span><span className="text-gray-500"> · Receipt </span><span className="font-mono text-gray-800 dark:text-gray-100">{receipt || "—"}</span></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={changeVendor}
                style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
                className={`font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
                Yes, different tote
              </button>
              <button type="button" onClick={() => setLeaveToteConfirm(false)}
                style={{ background: CAT_ACCENT, color: "#1C1C1E", touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
                className={`font-semibold rounded-lg ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
                No, stay here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change vendor/tote confirmation */}
      {changeConfirm && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={() => setChangeConfirm(null)}>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">Change vendor?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">You&apos;re about to switch what you&apos;re cataloguing to:</p>
            <div className="rounded-xl bg-gray-100 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm space-y-1 mb-3">
              <div><span className="text-gray-500">Vendor </span><span className="font-mono text-gray-800 dark:text-gray-100">{changeConfirm.vendor}</span>{changeConfirm.vendorName && <span className="text-gray-500"> · {changeConfirm.vendorName}</span>}</div>
              <div><span className="text-gray-500">Tote </span><span className="font-mono text-gray-800 dark:text-gray-100">{changeConfirm.tote}</span></div>
              <div><span className="text-gray-500">Receipt </span><span className="font-mono text-gray-800 dark:text-gray-100">{changeConfirm.receipt}</span></div>
            </div>
            {locked && (
              <p className="text-xs text-gray-500 mb-4">Currently: {locked.vendor}{locked.vendorName ? ` · ${locked.vendorName}` : ""} · Tote {locked.tote} · Receipt {locked.receipt}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setChangeConfirm(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400">Cancel</button>
              <button type="button" onClick={() => commitStart(changeConfirm)}
                className="px-4 py-2 text-sm font-semibold rounded-lg" style={{ background: CAT_ACCENT, color: "#1C1C1E" }}>Yes, change vendor</button>
            </div>
          </div>
        </div>
      )}

      {/* Auction context banner */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <span className={`${tablet ? "text-sm" : "text-xs"} text-gray-600 dark:text-gray-500 uppercase tracking-wider`}>Adding to:</span>
        <span className={`font-mono font-bold text-[#2AB4A6] ${tablet ? "text-base" : "text-sm"}`}>{auction.code}</span>
        <span className={`text-gray-600 dark:text-gray-300 ${tablet ? "text-base" : "text-sm"}`}>{auction.name}</span>
        <div className="ml-auto flex items-center gap-4">
          {timerActive && showLotTimer && (
            <span className={`flex items-center gap-1.5 font-mono font-bold tabular-nums ${tablet ? "text-base" : "text-sm"}`}
              style={{ color: timerSecs > timerRedSecs ? "#ef4444" : "#2AB4A6" }}>
              <svg className="w-3.5 h-3.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2"/>
              </svg>
              {String(Math.floor(timerSecs / 60)).padStart(2, "0")}:{String(timerSecs % 60).padStart(2, "0")}
            </span>
          )}
          {lotCount > 0 && (
            <span className={`text-green-400 font-bold ${tablet ? "text-base" : "text-sm"}`}>{lotCount} lot{lotCount !== 1 ? "s" : ""} today</span>
          )}
        </div>
      </div>

      {/* ⚠⚠ The app was updated while this page was open. Their Save is talking to a build the
          server no longer has, so it will keep failing until this tab is reloaded — which is what
          left iPads stuck showing "an error occurred" and quietly not recording anything.
          Deliberately NOT an automatic reload: the lot on screen and any photos already taken
          would go with it. Say what happened, say nothing was saved, let them choose. */}
      {/* Step indicator */}
      <div className="flex mb-5 border-b border-gray-200 dark:border-gray-800">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex-1 min-w-0 pb-2 text-center border-b-2 transition-colors"
            style={{ borderColor: i + 1 === step ? CAT_ACCENT : i + 1 < step ? "#22c55e" : "#374151" }}>
            {tablet ? (
              <span className="block text-sm font-semibold px-1"
                style={{ color: i + 1 === step ? CAT_ACCENT : i + 1 < step ? "#22c55e" : "#6b7280" }}>
                {i + 1}
              </span>
            ) : (
              <span className="block text-xs truncate px-1"
                style={{ color: i + 1 === step ? CAT_ACCENT : i + 1 < step ? "#22c55e" : "#6b7280", fontWeight: i + 1 === step ? 600 : 400 }}>
                {i + 1}. {label}
              </span>
            )}
          </div>
        ))}
      </div>
      {tablet && (
        <p className={`text-center font-semibold mb-3`} style={{ color: CAT_ACCENT }}>
          Step {step} of 8 — {STEP_LABELS[step - 1]}
        </p>
      )}

      {validErr && <p className="text-red-400 text-sm mb-3">{validErr}</p>}

      {/* Top nav */}
      <div className={`flex items-center justify-between mb-3 sticky top-0 z-10 bg-gray-50 dark:bg-[#141416] -mx-1 px-1 border-b border-gray-200/50 dark:border-gray-800/50 ${tablet ? "py-3" : "py-2"}`}>
        <button onClick={goBack} disabled={step === 1}
          style={{ touchAction: tablet ? "manipulation" : undefined }}
          className={`bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded transition-colors disabled:opacity-30 hover:border-gray-400 dark:hover:border-gray-500 ${tablet ? "px-6 py-3 text-base font-medium" : "px-4 py-1.5 text-sm"}`}>
          ← Back
        </button>
        <span className={`text-gray-600 ${tablet ? "text-base" : "text-xs"}`}>{step} / 8</span>
        {step < 8 ? (
          <button onClick={step === 1 ? startCataloguing : goNext}
            disabled={barcodeWarning || step1LengthWarning || !!dupeWarning || !!dupeCheckError || checkingBarcode}
            className={`font-semibold rounded transition-colors disabled:opacity-40 ${tablet ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
            style={{ background: CAT_ACCENT, color: "#1C1C1E", touchAction: tablet ? "manipulation" : undefined }}>
            {checkingBarcode ? "Checking…" : step === 1 ? "Start cataloguing →" : "Next →"}
          </button>
        ) : (
          <button onClick={saveLot} disabled={pending}
            className={`font-semibold rounded transition-colors disabled:opacity-50 ${tablet ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
            style={{ background: CAT_ACCENT, color: "#1C1C1E", touchAction: tablet ? "manipulation" : undefined }}>
            {pending ? "Saving…" : photoFiles.length > 0 ? "Save Lot ✓" : "Skip & Save ✓"}
          </button>
        )}
      </div>

      {/* Step content
          ⚠⚠ THE BANNERS AT THE FOOT OF THIS DIV LIVE INSIDE IT ON PURPOSE (Jordan, 2026-09-09:
          "on some cases they push things off the screen you cant scroll to"). This component is a
          fixed-height column — on the tablet it is `position: fixed; inset: 0` — so anything placed
          as a SIBLING above this div permanently steals height from it and cannot itself be
          scrolled. On a phone, two banners plus the step strip left barely any room for the form.
          Anything new that is not a control for moving between steps goes in here, not above. */}
      {/* ⚠⚠ `min-h-0` IS LOad-BEARING, NOT TIDYING. A flex item defaults to `min-height: auto`, which
          means it refuses to shrink below its content. So `flex-1 overflow-y-auto` inside a
          fixed-height column does NOT scroll — it grows past the bottom of the screen and the
          overflow is simply unreachable, which is exactly what Jordan hit on a phone. With
          `min-h-0` it can shrink and the scrollbar does its job. Never remove it. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Desktop only (desk: = a mouse AND a wide screen — Jordan, 2026-09-11): the step and its
            banners in a wider column, with "This lot so far" beside it. On a tablet these two
            wrappers do nothing at all. */}
        <div className="desk:flex desk:items-start desk:gap-8">
        <div className="min-w-0 desk:w-full desk:max-w-3xl">
        {step === 1 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-gray-600 dark:text-gray-500">Type or scan the tote — the vendor &amp; receipt fill in automatically. Press <span className="font-semibold" style={{ color: CAT_ACCENT }}>Start cataloguing</span> to lock them in for the batch (they&apos;re remembered next time too).</p>
              {/* One button to empty all three boxes — the tablet cataloguers change
                  vendor often and were clearing each field on its own. */}
              {(tote || vendor || receipt) && (
                <button
                  type="button"
                  onClick={clearVendorFields}
                  title="Empty the tote, vendor and receipt boxes"
                  className={`flex-shrink-0 font-semibold rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-gray-600 dark:text-gray-400 hover:border-red-500 hover:text-red-400 transition-colors ${tablet ? "px-5 py-3 text-base" : "px-3 py-1.5 text-xs"}`}
                  style={{ touchAction: tablet ? "manipulation" : undefined }}
                >
                  ✕ Clear vendor details
                </button>
              )}
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Tote Number <span className="text-red-500">*</span></label>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    value={tote}
                    onChange={e => {
                      // Tote is the source of truth: editing it clears the derived vendor/receipt
                      // so a not-in-BC tote can't keep the previous batch's vendor/receipt (mismatch).
                      // selectTote / a successful blur lookup re-populate them for a real BC tote.
                      setTote(e.target.value); setVendor(""); setReceipt(""); setVendorHint(null)
                      setToteInfo(null); setToteInfoFor(""); setToteMeta(null); setToteIgnored(false); setToteContents(null)
                      setVendorTyped(false); setReceiptTyped(false); setRestoredFromLast(false); setToteChoices(null); setHidden({})
                      searchTotes(e.target.value); setStep1LengthWarning(false)
                    }}
                    // ⚠ select() matters because the box is ALWAYS full: a tote is always exactly
                    // 7 characters and maxLength is 7 (deliberately). Without this, tapping in and
                    // typing is silently refused by the browser — no character appears, no onChange
                    // fires — and the box reads as broken.
                    onFocus={e => { e.target.select(); if (e.target.value) searchTotes(e.target.value) }}
                    onBlur={e => {
                      setTimeout(() => setToteOpen(false), 150)
                      const v = e.target.value.trim()
                      // Look up only when this is a DIFFERENT tote from the one already described.
                      if (v && v.toUpperCase() !== toteInfoFor.toUpperCase()) lookupVendorFromBC({ tote: v })
                    }}
                    className={`flex-1 ${inpFocus}`}
                    placeholder="Type the BC tote number…"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoFocus
                    maxLength={7}
                  />
                  {/* ⚠ Calls the shared clearVendorFields() — this used to be a third hand-written
                      copy of the same reset, which is exactly the drift that helper's own comment
                      warns about, and it missed the new provenance/freshness state. */}
                  {tote && <button type="button" onClick={clearVendorFields} className={`bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 rounded hover:border-red-500 hover:text-red-400 ${tablet ? "px-4 py-3 text-sm min-w-[44px]" : "px-3 py-2 text-xs"}`} title="Clear tote, vendor and receipt">✕</button>}
                </div>
                {toteOpen && toteResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded shadow-xl max-h-52 overflow-y-auto">
                    {/* ⚠ These rows list the typed tote's NEIGHBOURS (P005021, P005022, P005023…),
                        which belong to different consignments, so the row has to carry enough to
                        tell them apart — the receipt was already being fetched and simply never
                        shown. Touch target raised to ~44px on the tablets (house rule). */}
                    {/* ⚠⚠ THE INDEX IS IN THE KEY DELIBERATELY (2026-09-09). This was
                        `${item.toteNo}|${item.receiptNo}`, and BC has 7 totes booked TWICE onto the
                        same receipt (two line numbers), which made two rows share a key. React's
                        reconciler keeps one fiber per key in its lookup map, so the other was never
                        deleted: its DOM node survived every keystroke and sat stranded at the top of
                        the list, still wired to the customer it was rendered for. Typing T027204
                        offered a leftover "T000005 · Debbie Dillon" row that would have started the
                        batch under the wrong customer. The duplicate-key warning is development-only
                        and is stripped from the production build, so nothing was ever logged.
                        The list is fully replaced on every response and the rows hold no state of
                        their own, so an index in the key is safe here. The duplicate is ALSO removed
                        at source in lib/receipt-totes.ts — this is the second line of defence, for
                        whatever BC does next. */}
                    {toteResults.map((item: any, i: number) => (
                      <button key={`${item.toteNo}|${item.receiptNo ?? ""}|${i}`} type="button" onMouseDown={() => selectTote(item)}
                        className={`w-full text-left hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0 ${tablet ? "px-4 py-3" : "px-3 py-2.5"}`}
                        style={{ minHeight: tablet ? 48 : 40, touchAction: tablet ? "manipulation" : undefined }}>
                        <span className={`font-mono text-[#2AB4A6] ${tablet ? "text-base" : "text-sm"}`}>{item.toteNo}</span>
                        {item.receiptNo && <span className={`font-mono text-gray-700 dark:text-gray-300 ml-2 ${tablet ? "text-sm" : "text-xs"}`}>{item.receiptNo}</span>}
                        {item.catalogued && <span className="text-amber-600 dark:text-amber-400 text-xs ml-2">· already catalogued</span>}
                        <span className="block text-gray-600 dark:text-gray-400 text-xs mt-0.5">
                          {item.vendorName || (item.vendorNo ? item.vendorNo : "No customer on this tote in BC")}
                          {item.location && <span className="text-gray-500"> · {item.location}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Live format warning — fires as they type, names THIS field, and says the rule is
                  always, not "normally". Tote/vendor/receipt are always 7 characters in a fixed
                  shape, so a wrong leading letter (a receipt typed into the vendor box) is a fact
                  we can point out immediately rather than at the end. */}
              {identityWarning("tote", tote) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠ {identityWarning("tote", tote)}</p>
              )}

              {/* ⚠⚠ BC has this tote on more than one receipt. Show BOTH and let a person choose —
                  vendor and receipt are left empty until they do. This is the case that used to be
                  invisible: the tote-keyed cache kept whichever receipt the sync wrote last, so the
                  screen gave one confident answer to a question with two. */}
              {toteChoices && toteChoices.length > 1 && (
                <div className="mt-2 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-3">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    BC has tote {tote} on {toteChoices.length} receipts. Which one is in front of you?
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {/* Same reason as the dropdown above: one option per receipt is guaranteed by
                        the route now, and the index keeps the key unique regardless. */}
                    {toteChoices.map((o, i) => (
                      <button key={`${o.receiptNo}|${i}`} type="button"
                        onClick={() => selectTote({ toteNo: tote, receiptNo: o.receiptNo, vendorNo: o.vendorNo, vendorName: o.vendorName, catalogued: o.catalogued })}
                        style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 48 : 40 }}
                        className={`w-full text-left rounded-lg border border-amber-600/40 bg-white/60 dark:bg-[#1C1C1E]/60 hover:border-amber-500 ${tablet ? "px-4 py-3" : "px-3 py-2"}`}>
                        <span className={`font-semibold text-gray-900 dark:text-white ${tablet ? "text-base" : "text-sm"}`}>
                          {o.vendorName || o.vendorNo || "No customer name"}
                        </span>
                        <span className="block font-mono text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          {o.receiptNo}{o.vendorNo ? ` · ${o.vendorNo}` : ""}
                          {o.catalogued ? " · already catalogued" : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                    Nothing has been filled in until you pick one.
                  </p>
                </div>
              )}

              {/* ⚠⚠ THE CUSTOMER NAME IS THE ONLY THING A PERSON CAN CHECK against the paperwork in
                  their hand, so it is the biggest thing here — it used to be 11px grey-teal text.
                  A mistyped but VALID tote number (P005023 for P005022) resolves perfectly and
                  fills in a different consignment's customer; nothing else on this screen can
                  catch that. */}
              {toteInfo && toteInfo.vendorNo && (() => {
                // ⚠ Sync age no longer colours anything. Amber has to be explainable in a
                // sentence next to it, and the sentence it had has gone.
                const flagged = !!toteMeta?.catalogued || toteMeta?.source === "item"
                return (
                  <div className={`mt-2 rounded-lg border px-3 py-2.5 ${flagged
                    ? "border-amber-500/60 bg-amber-500/10"
                    : "border-[#2AB4A6]/50 bg-[#2AB4A6]/10"}`}>
                    <p className={`font-semibold leading-tight ${tablet ? "text-lg" : "text-base"} ${flagged ? "text-amber-700 dark:text-amber-300" : "text-[#178F84] dark:text-[#2AB4A6]"}`}>
                      {toteInfo.vendorName || "No customer name in BC"}
                    </p>
                    <p className={`font-mono text-gray-700 dark:text-gray-300 mt-0.5 ${tablet ? "text-sm" : "text-xs"}`}>
                      {toteInfo.vendorNo}{toteInfo.receiptNo ? ` · ${toteInfo.receiptNo}` : ""}
                    </p>
                    {toteMeta?.catalogued && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5">
                        ⚠ BC has already ticked this tote catalogued. If it has been emptied and re-used, this is the
                        previous customer — check the receipt on the paperwork.
                      </p>
                    )}
                    {toteMeta?.source === "item" && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1.5">
                        ⚠ BC has no receipt for this tote. This customer comes from an older item that was in it, so it
                        may not be who it belongs to now.
                      </p>
                    )}
                    {/* ⚠ NOTHING ABOUT WHEN OUR COPY OF BC WAS PULLED (Jordan, 2026-09-09: "the
                        cataloguers dont need to know that"). It is our plumbing, not their job, and
                        a line they cannot act on is noise on a screen they use all day. The
                        re-used-tote case is still covered in words by the "already catalogued"
                        warning above, which is a fact about the tote rather than about our sync. */}
                  </div>
                )
              })()}

              {/* The tote IS in BC but has no receipt or customer on it yet. This used to render as
                  an empty "  ()" label with the not-found warning suppressed, which said nothing. */}
              {toteMeta?.source === "tote-shell" && (!toteInfo || !toteInfo.vendorNo) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                  ⚠ BC knows this tote but has not put it on a receipt yet, so there is no customer to fill in.
                  Type the vendor and receipt from the paperwork.
                </p>
              )}

              {tote && !toteInfo && !toteMeta && !toteIgnored && toteResults.length === 0 && (
                <div className={`flex flex-wrap items-center gap-3 mt-2 rounded-lg border border-amber-500/60 bg-amber-500/10 ${tablet ? "px-4 py-3" : "px-3 py-2"}`}>
                  <p className="text-sm text-amber-700 dark:text-amber-300">This tote is not in our copy of BC. Check the number.</p>
                  <button type="button" onClick={() => setToteIgnored(true)}
                    style={{ touchAction: tablet ? "manipulation" : undefined }}
                    className={`font-semibold rounded border border-amber-600/50 text-amber-700 dark:text-amber-200 hover:bg-amber-500/20 ${tablet ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs"}`}>
                    Use it anyway
                  </button>
                </div>
              )}
              {toteIgnored && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Using a tote BC does not know. Nothing has been checked — type the vendor and receipt carefully.
                </p>
              )}
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Vendor Number <span className="text-red-500">*</span> <span className="normal-case font-normal text-gray-500">— auto-filled from the tote</span></label>
              <div className="flex gap-2">
                {/* ⚠ maxLength 7 is deliberate (a vendor number is always C + 6 digits), which is
                    exactly why select-on-focus is needed: the box is ALWAYS full, so without it
                    tapping in and typing is refused by the browser and nothing happens at all —
                    which is what someone trying to correct a wrong vendor runs into. */}
                <input value={vendor}
                  onChange={e => { setVendor(e.target.value); setVendorHint(null); setVendorTyped(true); setStep1LengthWarning(false) }}
                  onFocus={e => e.target.select()}
                  className={`flex-1 ${inpFocus}`} placeholder="e.g. C224521" maxLength={7} autoCapitalize="characters" />
                {vendor && <button type="button" onClick={() => { setVendor(""); setVendorHint(null); setVendorTyped(false) }} className={`bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 rounded hover:border-red-500 hover:text-red-400 ${tablet ? "px-4 py-3 text-sm min-w-[44px]" : "px-3 py-2 text-xs"}`}>✕</button>}
              </div>
              {identityWarning("vendor", vendor) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠ {identityWarning("vendor", vendor)}</p>
              )}
              {vendorHint && <p className="text-xs text-[#2AB4A6] mt-1">{vendorHint}</p>}
              {vendor.trim() && toteInfo?.vendorNo && !hidden.vendorDiff && vendor.trim().toUpperCase() !== toteInfo.vendorNo.toUpperCase() && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-2"><span className="flex-1">
                  ⚠ BC has {toteInfo.vendorNo} for tote {tote}{toteInfo.vendorName ? ` (${toteInfo.vendorName})` : ""}.
                  {vendorTyped ? " This will be saved as you typed it." : " This value was carried over, not taken from this tote."}
                </span><Dismiss k="vendorDiff" /></p>
              )}
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Receipt Number <span className="text-red-500">*</span> <span className="normal-case font-normal text-gray-500">— auto-filled from the tote</span></label>
              <div className="flex gap-2">
                <input
                  value={receipt}
                  onChange={e => { setReceipt(e.target.value); setReceiptTyped(true); setStep1LengthWarning(false) }}
                  onFocus={e => e.target.select()}
                  onBlur={e => { if (e.target.value.trim() && !tote.trim()) lookupVendorFromBC({ receipt: e.target.value.trim() }) }}
                  className={`flex-1 ${inpFocus}`}
                  placeholder="e.g. R007523"
                  maxLength={7}
                  autoCapitalize="characters"
                />
                {receipt && <button type="button" onClick={() => { setReceipt(""); setReceiptTyped(false) }} className={`bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 rounded hover:border-red-500 hover:text-red-400 ${tablet ? "px-4 py-3 text-sm min-w-[44px]" : "px-3 py-2 text-xs"}`}>✕</button>}
              </div>
              {identityWarning("receipt", receipt) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">⚠ {identityWarning("receipt", receipt)}</p>
              )}
              {/* ⚠ The old line here promised "Unique ID will be auto-assigned (R007523-N)". The Hub
                  has minted no unique IDs since 2026-08-06 — BC's numbering is the only source, and
                  🔗 BC Match imports it later — so that text was both untrue and implied the receipt
                  had been validated. Removed rather than reworded; the box needs no caption. */}
              {receipt.trim() && toteInfo?.receiptNo && !hidden.receiptDiff && receipt.trim().toUpperCase() !== toteInfo.receiptNo.toUpperCase() && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-2"><span className="flex-1">
                  ⚠ BC has {toteInfo.receiptNo} for tote {tote}.
                  {receiptTyped ? " This will be saved as you typed it." : " This value was carried over, not taken from this tote."}
                </span><Dismiss k="receiptDiff" /></p>
              )}
            </div>

            {step1LengthWarning && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-500/10 dark:bg-amber-950/40 px-4 py-3 space-y-3">
                {/* ⚠ Was "normally exactly 7 characters", which reads as a suggestion. They are
                    ALWAYS 7 in a fixed shape (Jordan, 2026-09-08), and the warning now names which
                    field is wrong instead of leaving the person to work it out. */}
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚠ Check this before you carry on</p>
                <ul className="text-sm text-amber-700 dark:text-amber-300 list-disc pl-5 space-y-1">
                  {checkIdentityTrio({ tote, vendor, receipt }).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
                <button type="button"
                  onClick={() => { setStep1LengthWarning(false); afterStartChecks() }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40 transition-colors">
                  Continue anyway
                </button>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-500">Scan the internal barcode or type it manually.</p>
            {/* The tote / vendor / receipt strip that used to sit here has moved above the step
                indicator, so it shows on every step rather than only this one. */}
            <div>
              <label className={`${lbl} block mb-1`}>Internal Barcode <span className="text-red-500">*</span></label>
              <input value={barcode}
                // Start timing the moment the field is focused for a new lot, not
                // only on a keystroke. The field auto-focuses when a new lot opens,
                // so this fires however the barcode arrives — typed, keyboard-wedge
                // scanned, pasted, autofilled, or injected by a mobile scanner app
                // (a programmatic value set never fires onChange). Without this, a
                // phone that fills the barcode without a keystroke left the timer
                // un-started → durationMs 0 → no timing log → the idle gate had no
                // baseline and never fired. Guarded so it never restarts mid-lot.
                onFocus={() => { if (!barcodeStartedAt.current && !idlePopup) startLotTiming() }}
                onChange={e => {
                const v = e.target.value
                if (v && !barcode && !barcodeStartedAt.current) startLotTiming()
                // Blue lot timer starts on the first actual barcode character, not
                // on focus — so it only appears once cataloguing has really begun.
                if (v) startLotTimerDisplay()
                setBarcode(v)
                if (barcodeWarning) setBarcodeWarning(false)
                if (dupeWarning) setDupeWarning(null)
                if (dupeCheckError) setDupeCheckError(null)
              }} className={inpFocus} placeholder="Scan or type barcode…" autoFocus />
            </div>
            <button type="button" onClick={nextBarcodeNumber}
              className="px-4 py-2 text-sm rounded transition-colors"
              style={{ background: "#2C2C2E", color: CAT_ACCENT, border: `1px solid ${CAT_ACCENT}66` }}>
              ⊕ Next Barcode Number
            </button>

            {/* Barcode already assigned — red rather than the house amber
                because this one is a fact, not a heuristic: a live lookup found
                the barcode on a real lot. */}
            {dupeWarning && (
              <div className="rounded-xl border border-red-600/60 bg-red-950/40 px-4 py-3 space-y-3">
                <p className="text-sm text-red-300">
                  ⚠ Barcode <strong>{barcode.trim().toUpperCase()}</strong> is already assigned.
                  Cataloguing it again would create a duplicate.
                </p>
                <div className="rounded-lg bg-black/30 border border-red-800/40 px-3 py-2 space-y-0.5">
                  <p className="text-xs text-red-200/90">
                    Already on: <strong>{dupeWarning.title || "Untitled"}</strong>
                  </p>
                  <p className="text-xs text-red-300/70">
                    {dupeWarning.sameAuctionId === auctionId
                      ? "In this auction"
                      : `In auction ${dupeWarning.auctionCode.toUpperCase()}${dupeWarning.auctionName ? ` — ${dupeWarning.auctionName}` : ""}`}
                    {dupeWarning.createdByName ? ` · catalogued by ${dupeWarning.createdByName}` : ""}
                  </p>
                  {dupeWarning.receiptUniqueId && (
                    <p className="text-xs text-red-300/70">Unique ID: {dupeWarning.receiptUniqueId}</p>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button type="button"
                    onClick={() => { setBarcode(""); setDupeWarning(null) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-700/40 hover:bg-red-700/60 text-red-200 border border-red-600/40 transition-colors">
                    Change barcode
                  </button>
                  <button type="button"
                    onClick={() => { setDupeWarning(null); setStep(3) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-600/40 transition-colors">
                    Continue anyway
                  </button>
                </div>
              </div>
            )}

            {/* The check itself failed. Never silently continue — that would
                wave through the duplicate this is meant to catch — but never
                block cataloguing on an outage either: it's their call. */}
            {dupeCheckError && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 space-y-3">
                <p className="text-sm text-amber-300">
                  ⚠ Couldn&apos;t check whether this barcode is already assigned ({dupeCheckError}).
                  It may or may not be a duplicate.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button"
                    onClick={() => { setDupeCheckError(null); goNext() }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40 transition-colors">
                    Try again
                  </button>
                  <button type="button"
                    onClick={() => { setDupeCheckError(null); setStep(3) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-600/40 transition-colors">
                    Continue anyway
                  </button>
                </div>
              </div>
            )}

            {/* Barcode mismatch warning */}
            {barcodeWarning && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 space-y-3">
                <p className="text-sm text-amber-300">
                  ⚠ Barcode <strong>{barcode.trim().toUpperCase()}</strong> doesn&apos;t look like it belongs to auction <strong>{auction.code.toUpperCase()}</strong>. You may be in the wrong auction.
                </p>
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => { setBarcodeWarning(false); setStep(3) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40 transition-colors">
                    Continue anyway
                  </button>
                  <button type="button"
                    onClick={() => router.push("/tools/cataloguing/auctions")}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-600/40 transition-colors">
                    Change auction
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            {/* ⚠ Hidden for a cataloguer set to write their own descriptions: there is no choice
                to make, and the box being tickable is exactly how hand-written lots ended up
                inside the AI's scope. They get the description field and nothing else. */}
            {manualDescriptions ? (
              <p className={`px-3 py-2.5 rounded-lg border border-amber-600/60 bg-amber-950/40 text-amber-300 w-fit ${tablet ? "text-base" : "text-sm"} font-medium`}>
                ✍ You write your own descriptions — this lot is excluded from AI automatically.
              </p>
            ) : (
              <label className={`flex items-center gap-3 cursor-pointer px-3 py-2.5 rounded-lg border transition-colors w-fit ${aiExcluded ? "bg-amber-950/40 border-amber-600/60 text-amber-300" : "border-gray-700 text-gray-500 hover:border-gray-500"}`}>
                <input type="checkbox" checked={aiExcluded} onChange={e => setAiExcluded(e.target.checked)}
                  className="w-4 h-4 accent-amber-500" />
                <span className={tablet ? "text-base font-medium" : "text-sm font-medium"}>Exclude from AI — description typed manually</span>
              </label>
            )}
            {aiExcluded ? (
              <div>
                <label className={`${lbl} block mb-1`}>Description <span className="text-gray-500">(typed manually — will not be sent to AI)</span></label>
                <textarea value={manualDesc} onChange={e => setManualDesc(e.target.value)} rows={7}
                  placeholder="Type the full description for this lot…"
                  className={`${inpFocus} resize-none desk:min-h-[20rem]`} autoFocus />
              </div>
            ) : (
              <div>
                <label className={`${lbl} block mb-1`}>Key Points <span className="text-gray-600">(optional)</span></label>
                <textarea value={keyPoints} onChange={e => setKeyPoints(e.target.value)} rows={6}
                  placeholder="Describe any key points about this lot…"
                  className={`${inpFocus} resize-none desk:min-h-[18rem]`} autoFocus />
              </div>
            )}
            {misspelled.length > 0 && (
              <p className={`text-amber-500 ${tablet ? "text-sm" : "text-xs"}`}>
                ⚠ Possible spelling {misspelled.length === 1 ? "mistake" : "mistakes"}:{" "}
                <span className="font-semibold">{misspelled.join(", ")}</span>
                <span className="text-gray-500"> — please double-check.</span>
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="max-w-lg desk:max-w-3xl space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Main Category</label>
                <button type="button" onClick={() => setPinnedMain(mainCat)}
                  className={`rounded transition-colors ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
                  style={{ color: pinnedMain === mainCat && mainCat ? CAT_ACCENT : "#6b7280", border: `1px solid ${pinnedMain === mainCat && mainCat ? CAT_ACCENT + "66" : "#374151"}` }}>
                  {pinnedMain === mainCat && mainCat ? "📌 Pinned" : "Pin"}
                </button>
              </div>
              <Autocomplete value={mainCat} onChange={v => { setMainCat(v); if (!categoryMap[v]) setSubCat(""); if (categoryWarning) setCategoryWarning(null) }}
                options={mainCatList} placeholder="Select main category…" tablet={tablet} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Sub Category</label>
                <button type="button" onClick={() => setPinnedSub(subCat)}
                  className={`rounded transition-colors ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
                  style={{ color: pinnedSub === subCat && subCat ? CAT_ACCENT : "#6b7280", border: `1px solid ${pinnedSub === subCat && subCat ? CAT_ACCENT + "66" : "#374151"}` }}>
                  {pinnedSub === subCat && subCat ? "📌 Pinned" : "Pin"}
                </button>
              </div>
              <Autocomplete value={subCat} onChange={v => { setSubCat(v); if (categoryWarning) setCategoryWarning(null) }} options={subCats}
                placeholder={mainCat ? "Select sub-category…" : "Select main category first…"} tablet={tablet} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Brand</label>
                <button type="button" onClick={() => setPinnedBrand(brand)}
                  className={`rounded transition-colors ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
                  style={{ color: pinnedBrand === brand && brand ? CAT_ACCENT : "#6b7280", border: `1px solid ${pinnedBrand === brand && brand ? CAT_ACCENT + "66" : "#374151"}` }}>
                  {pinnedBrand === brand && brand ? "📌 Pinned" : "Pin"}
                </button>
              </div>
              <Autocomplete value={brand} onChange={setBrand} options={BRANDS_LIST} placeholder="Search brand…" tablet={tablet} />
            </div>

            {/* Non-preset category warning */}
            {categoryWarning && (() => {
              const typed = categoryWarning === "main" ? mainCat.trim() : subCat.trim()
              const list  = categoryWarning === "main" ? mainCatList : subCats
              // Often it's only capitalisation that's off — offer the preset as a one-tap fix.
              const closeMatch = list.find(c => c.toLowerCase() === typed.toLowerCase())
              return (
                <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 space-y-3">
                  <p className="text-sm text-amber-300">
                    ⚠ {categoryWarning === "main"
                      ? <>Main category <strong>{typed}</strong> isn&apos;t one of the preset categories</>
                      : <>Sub category <strong>{typed}</strong> isn&apos;t a preset sub-category of <strong>{mainCat.trim()}</strong></>}
                    {" "}— it won&apos;t match up in BC. Check for a typo, or pick from the list.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {closeMatch && (
                      <button type="button"
                        onClick={() => {
                          if (categoryWarning === "main") setMainCat(closeMatch)
                          else setSubCat(closeMatch)
                          setCategoryWarning(null)
                        }}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg text-[#1C1C1E] transition-colors"
                        style={{ background: CAT_ACCENT }}>
                        Use &ldquo;{closeMatch}&rdquo;
                      </button>
                    )}
                    <button type="button"
                      onClick={() => setCategoryWarning(null)}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-600/40 transition-colors">
                      Fix it
                    </button>
                    <button type="button"
                      onClick={() => { setCategoryWarning(null); setStep(5) }}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40 transition-colors">
                      Continue anyway
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {step === 5 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            <div className="flex gap-6">
              <div className="flex-1 space-y-3">
                <div>
                  <label className={`${lbl} block mb-1`}>Estimate Low £ <span className="text-red-500">*</span></label>
                  <input value={estLow} onChange={e => { setEstLow(e.target.value); if (estimateWarning) setEstimateWarning(false) }} className={inpFocus} placeholder="e.g. 40" autoFocus />
                </div>
                <div>
                  <label className={`${lbl} block mb-1`}>Estimate High £ <span className="text-red-500">*</span></label>
                  <input value={estHigh} onChange={e => { setEstHigh(e.target.value); if (estimateWarning) setEstimateWarning(false) }} className={inpFocus} placeholder="e.g. 60" />
                </div>
              </div>
              <div className="space-y-2">
                {([["Low", estLow, setEstLow], ["High", estHigh, setEstHigh]] as const).map(([label, val, setter]) => (
                  <div key={label} className="bg-gray-100 dark:bg-[#2C2C2E] rounded-lg p-3 border border-gray-300 dark:border-gray-700">
                    <p className={`${lbl} mb-2`}>{label}</p>
                    <div className="flex flex-wrap gap-1">
                      {ESTIMATE_VALUES.map(v => (
                        <button key={v} type="button" onClick={() => { setter(String(v)); if (estimateWarning) setEstimateWarning(false) }}
                          className={`rounded transition-colors ${tablet ? "px-2.5 py-2 text-sm" : "px-2 py-1.5 text-xs"}`}
                          style={{
                            background: val === String(v) ? CAT_ACCENT : "#1C1C1E",
                            color:      val === String(v) ? "#1C1C1E" : "#d1d5db",
                            border:     `1px solid ${val === String(v) ? CAT_ACCENT : "#374151"}`,
                          }}>
                          £{v}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Low-above-high warning */}
            {estimateWarning && (
              <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-4 py-3 space-y-3">
                <p className="text-sm text-amber-300">
                  ⚠ Estimate Low (<strong>£{estLow.replace(/[£,]/g, "").trim()}</strong>) is higher than Estimate High (<strong>£{estHigh.replace(/[£,]/g, "").trim()}</strong>) — they look the wrong way round.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button type="button"
                    onClick={() => { const lo = estLow; setEstLow(estHigh); setEstHigh(lo); setEstimateWarning(false); setStep(6) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg text-[#1C1C1E] transition-colors"
                    style={{ background: CAT_ACCENT }}>
                    Swap them &amp; continue
                  </button>
                  <button type="button"
                    onClick={() => setEstimateWarning(false)}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-600/40 transition-colors">
                    Fix it
                  </button>
                  <button type="button"
                    onClick={() => { setEstimateWarning(false); setStep(6) }}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-700/40 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40 transition-colors">
                    Continue anyway
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="max-w-lg desk:max-w-3xl space-y-5">
            <div>
              <label className={`${lbl} block mb-2`}>Condition</label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={cond1 === c} onClick={() => setCond1(v => v === c ? "" : c)} tablet={tablet} />)}
              </div>
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Condition To <span className="text-gray-600">(optional)</span></label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={cond2 === c} onClick={() => setCond2(v => v === c ? "" : c)} tablet={tablet} />)}
              </div>
            </div>

            {/* Optional separate box / packaging condition */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={boxOn} onChange={e => setBoxOn(e.target.checked)}
                  className="w-4 h-4 accent-[#2AB4A6]" style={{ touchAction: "manipulation" }} />
                <span className={lbl}>Add a separate box / packaging condition</span>
              </label>

              {boxOn && (
                <div className="mt-3 space-y-4">
                  {/* Wording */}
                  <div>
                    <label className={`${lbl} block mb-2`}>Wording</label>
                    <div className="flex flex-wrap gap-2">
                      {boxWordings.map(p => (
                        <CondBtn key={p} label={p} selected={boxPrefixMode === p} onClick={() => setBoxPrefixMode(p)} tablet={tablet} />
                      ))}
                      <CondBtn label="Custom…" selected={boxPrefixMode === "custom"} onClick={() => setBoxPrefixMode("custom")} tablet={tablet} />
                    </div>
                    {boxPrefixMode === "custom" && (
                      <input
                        value={boxCustomPrefix}
                        onChange={e => setBoxCustomPrefix(e.target.value)}
                        placeholder="e.g. Inner tray is"
                        className={`${inpFocus} mt-2`}
                        autoFocus
                      />
                    )}
                  </div>
                  {/* Grade (same quick-select as the main condition) */}
                  <div>
                    <label className={`${lbl} block mb-2`}>Packaging Condition</label>
                    <div className="flex flex-wrap gap-2">
                      {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={boxCond1 === c} onClick={() => setBoxCond1(v => v === c ? "" : c)} tablet={tablet} />)}
                    </div>
                  </div>
                  <div>
                    <label className={`${lbl} block mb-1`}>Packaging Condition To <span className="text-gray-600">(optional)</span></label>
                    <div className="flex flex-wrap gap-2">
                      {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={boxCond2 === c} onClick={() => setBoxCond2(v => v === c ? "" : c)} tablet={tablet} />)}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Will save as: <span className="text-gray-700 dark:text-gray-300 font-medium">{buildCondition() || "—"}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            <div>
              <label className={`${lbl} block mb-2`}>Parcel Size <span className="text-red-500">*</span></label>
              <div className="flex flex-wrap gap-2">
                {PARCEL_OPTIONS.map(opt => (
                  <button key={opt} type="button" onClick={() => setParcel(v => v === opt ? "" : opt)}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors border ${
                      parcel === opt ? "" : "bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700"}`}
                    style={parcel === opt ? { background: CAT_ACCENT, color: "#1C1C1E", borderColor: CAT_ACCENT } : undefined}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            {/* Summary */}
            <div className="bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <p><span className="text-gray-600">Auction:</span> {auction.code} {auction.name}</p>
              <p><span className="text-gray-600">Vendor:</span> {vendor} &nbsp;|&nbsp; <span className="text-gray-600">Tote:</span> {tote}{receipt && ` | Receipt: ${receipt}`}</p>
              <p><span className="text-gray-600">Barcode:</span> {barcode || "—"}</p>
              <p><span className="text-gray-600">Category:</span> {mainCat || "—"}{subCat && ` › ${subCat}`}</p>
              <p><span className="text-gray-600">Brand:</span> {brand || "—"}</p>
              <p><span className="text-gray-600">Estimate:</span> £{estLow}–£{estHigh}</p>
              <p><span className="text-gray-600">Condition:</span> {buildCondition() || "—"}</p>
              <p><span className="text-gray-600">Parcel:</span> {parcel || "—"}</p>
            </div>
          </div>
        )}

        {step === 8 && (
          <div className="max-w-lg desk:max-w-3xl space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-500">Add photos to this lot. You can skip this and add them later.</p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files ?? [])
                setPhotoFiles(prev => [...prev, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f) }))])
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="w-full py-4 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] transition-colors flex flex-col items-center gap-1"
            >
              <span className="text-2xl">📷</span>
              <span className="text-sm font-medium">Take photo</span>
            </button>
            {photoFiles.length > 0 && (
              <div className={`grid gap-3 ${tablet ? "grid-cols-2" : "grid-cols-3"}`}>
                {photoFiles.map((p, i) => (
                  <div key={i} className="relative aspect-square">
                    <img src={p.preview} alt={`Photo ${i + 1}`} className="w-full h-full object-cover rounded-lg border border-gray-700" />
                    <button type="button"
                      onClick={() => setPhotoFiles(prev => { URL.revokeObjectURL(prev[i].preview); return prev.filter((_, j) => j !== i) })}
                      className={`absolute -top-1.5 -right-1.5 bg-red-600 rounded-full text-white flex items-center justify-center ${tablet ? "w-8 h-8 text-sm -top-2 -right-2" : "w-5 h-5 text-xs"}`}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className={`text-gray-600 ${tablet ? "text-sm" : "text-xs"}`}>{photoFiles.length} photo{photoFiles.length !== 1 ? "s" : ""} added</p>
            {saveStatus && <p className="text-green-400 text-sm font-medium">{saveStatus}</p>}
          </div>
        )}

      {/* ⚠⚠ THE BANNERS ARE AT THE BOTTOM, BELOW THE STEP (Jordan, 2026-09-09: "these warning
          boxes need moving to the bottom of the page"). Earlier the same day: "on some cases
          they push things off the screen you cant scroll to". Sitting above the form they
          shoved the actual field a cataloguer had come to fill in down the screen — one banner
          on a phone, three on a bad day — so the answer to "where is the box I type in" was
          "scroll". They still appear on EVERY step, and they still live inside this scrolling
          area (never as a sibling above it, which would steal height from a fixed-height column
          and be unreachable). Do not move them back up.
          ⚠ `max-w-lg desk:max-w-3xl` on each, matching every step's own container — Jordan, same day: "why does it
          need to span the entire screen". A short status box stretched to 1,900px puts its dismiss
          ✕ a foot away from the sentence it dismisses and lines up with nothing on the page. The
          full-width rule in RULES.md is about DATA (tables, plans, comparisons); this is a label
          beside a form. */}
      {staleDeploy && (
        <div className="mt-4 max-w-lg desk:max-w-3xl rounded-xl border border-amber-500 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-bold text-amber-700 dark:text-amber-300">The app has been updated</p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            This lot was <strong>not saved</strong>. This page is the old version and cannot save until it is reloaded.
            Reloading clears what is on screen, including any photos you have taken but not saved, so write down
            anything you need first.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={() => window.location.reload()}
              style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
              className={`font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
              Reload now
            </button>
            <button type="button" onClick={() => setStaleDeploy(false)}
              style={{ touchAction: tablet ? "manipulation" : undefined, minHeight: tablet ? 44 : undefined }}
              className={`font-semibold rounded-lg border border-amber-600/50 text-amber-700 dark:text-amber-200 hover:bg-amber-500/20 ${tablet ? "px-5 py-3 text-base" : "px-4 py-2 text-sm"}`}>
              Not yet
            </button>
          </div>
        </div>
      )}

      {/* The lot saved, but remembering its tote/vendor/receipt for this sale did not. Harmless to
          the lot; it means the next visit would offer older numbers. Worth one line rather than the
          silence that made this hard to pin down in the first place. */}
      {rememberFailed && !staleDeploy && !hidden.remember && (
        <div className="mt-4 max-w-lg desk:max-w-3xl flex items-start gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-2.5">
          <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
            Your lot saved. The tote and vendor could not be remembered for next time, so check them when you come back.
          </p>
          <Dismiss k="remember" />
        </div>
      )}

      {/* ── Who this batch belongs to — visible on EVERY step ────────────────────
          It used to appear only on step 2, as 11px grey text, so from the key points onwards
          nothing on screen said whose lot was being catalogued. A batch started against the wrong
          customer was then never seen again until Tote Check — which cannot see it either, because
          the lot agrees with the tote it was filled from. The customer NAME leads: it is the only
          part a person can check against the paperwork in their hand. */}
      {step > 1 && (vendor || tote || receipt) && (() => {
        const overridden = (vendorTyped && !!toteInfo?.vendorNo && vendor.trim().toUpperCase() !== toteInfo.vendorNo.toUpperCase())
          || (receiptTyped && !!toteInfo?.receiptNo && receipt.trim().toUpperCase() !== toteInfo.receiptNo.toUpperCase())
        const flagged = overridden || restoredFromLast || !!toteMeta?.catalogued || toteMeta?.source === "item" || toteIgnored
        return (
          <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 max-w-lg desk:max-w-3xl rounded-xl border px-4 ${tablet ? "py-3" : "py-2.5"} ${
            flagged ? "border-amber-500/60 bg-amber-500/10" : "border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E]"}`}>
            {/* ⚠ ON THE LEFT, AND IT STAYS THERE (Jordan, 2026-09-09: "people keep pressing it on
                accident"). It used to sit at the right-hand end of this row — directly under the
                Next → button, about a hundred pixels below the one control a cataloguer presses on
                every single lot. A miss wipes the tote, vendor and receipt and throws the batch
                back to step 1. Distance from Next is the whole point; don't move it back to the
                right for tidiness. */}
            <button type="button" onClick={() => setLeaveToteConfirm(true)}
              style={{
                touchAction: tablet ? "manipulation" : undefined,
                minHeight:   tablet ? 44 : undefined,
                color:       CAT_ACCENT,
                border:      `1px solid ${CAT_ACCENT}66`,
              }}
              className={`flex-shrink-0 font-semibold rounded-lg transition-colors hover:bg-[#2AB4A6]/10 ${tablet ? "px-5 py-3 text-base" : "px-3.5 py-2 text-sm"}`}>
              Different tote
            </button>
            <div className="flex-1 min-w-0">
              <p className={`font-bold leading-tight ${tablet ? "text-lg" : "text-base"} ${flagged ? "text-amber-700 dark:text-amber-300" : "text-gray-900 dark:text-white"}`}>
                {vendorHint || toteInfo?.vendorName || "No customer name"}
              </p>
              <p className={`font-mono text-gray-600 dark:text-gray-400 mt-0.5 ${tablet ? "text-sm" : "text-xs"}`}>
                {vendor || "no vendor"} · {tote || "no tote"} · {receipt || "no receipt"}
              </p>
              {/* What goods-in wrote on BC's tote screen. Deliberately NOT styled as a warning —
                  it is information, and colouring it amber alongside the real flags would teach
                  people to ignore the amber. Nothing renders when BC has nothing. */}
              {toteContents && (
                <p className={`text-gray-700 dark:text-gray-300 mt-1 ${tablet ? "text-sm" : "text-xs"}`}>
                  <span className="text-gray-500">Contents: </span>{toteContents}
                </p>
              )}
              {overridden && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Typed by hand, not taken from BC.</p>}
              {toteMeta?.catalogued && !overridden && !hidden.catalogued && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-2">
                  <span className="flex-1">BC has this tote ticked catalogued.</span>
                  <Dismiss k="catalogued" />
                </p>
              )}
              {toteIgnored && !overridden && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">This tote is not in our copy of BC.</p>}
              {restoredFromLast && !overridden && !hidden.carried && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-2">
                  <span className="flex-1">Carried over from your last batch — check it is still the tote in front of you.</span>
                  <Dismiss k="carried" />
                </p>
              )}
            </div>
          </div>
        )
      })()}
        </div>

        {/* ── This lot so far — DESKTOP ONLY (Jordan, 2026-09-11) ─────────────────────────────
            Uses the empty right-hand side: everything entered so far, filled in as you go. A
            finished step can be clicked to go back to it (jumpBack — backwards only, so Next's
            checks are never skipped). Hidden on the tablets, where there is no room for it. */}
        {(() => {
          const soFar: { n: number; label: string; value: string }[] = [
            { n: 1, label: STEP_LABELS[0], value: [vendorHint || toteInfo?.vendorName, [vendor, tote, receipt].filter(Boolean).join(" · ")].filter(Boolean).join("\n") },
            { n: 2, label: STEP_LABELS[1], value: barcode },
            { n: 3, label: aiExcluded ? "Description" : STEP_LABELS[2], value: aiExcluded ? manualDesc : keyPoints },
            { n: 4, label: STEP_LABELS[3], value: [mainCat && (subCat ? `${mainCat} › ${subCat}` : mainCat), brand].filter(Boolean).join("\n") },
            { n: 5, label: STEP_LABELS[4], value: estLow || estHigh ? `£${estLow || "?"}–£${estHigh || "?"}` : "" },
            { n: 6, label: STEP_LABELS[5], value: buildCondition() },
            { n: 7, label: STEP_LABELS[6], value: parcel },
            { n: 8, label: STEP_LABELS[7], value: photoFiles.length ? `${photoFiles.length} photo${photoFiles.length === 1 ? "" : "s"}` : "" },
          ]
          return (
            <aside className="hidden desk:block desk:sticky desk:top-0 w-80 flex-shrink-0 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400">This lot so far</h3>
              <ol className="space-y-0.5">
                {soFar.map(row => {
                  const body = (
                    <>
                      <span className="block text-[11px] uppercase tracking-wider text-gray-500">{row.n}. {row.label}</span>
                      <span className={`block whitespace-pre-line break-words line-clamp-4 text-sm ${row.value ? "text-gray-900 dark:text-gray-100" : "text-gray-400 dark:text-gray-600"}`}>
                        {row.value || (row.n > step ? "not yet" : "—")}
                      </span>
                    </>
                  )
                  return (
                    <li key={row.n}>
                      {row.n < step ? (
                        <button type="button" onClick={() => jumpBack(row.n)} title={`Go back to step ${row.n}`}
                          className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5">
                          {body}
                        </button>
                      ) : (
                        <div className={`rounded-lg px-2 py-1.5 ${row.n === step ? "bg-[#2AB4A6]/10 ring-1 ring-[#2AB4A6]/40" : ""}`}>{body}</div>
                      )}
                    </li>
                  )
                })}
              </ol>
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                Click a finished step to go back to it. Going forward is always through Next, so no check is skipped.
              </p>
            </aside>
          )
        })()}
        </div>
      </div>

    </div>
  )
}
