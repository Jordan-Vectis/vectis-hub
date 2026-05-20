"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { createLot } from "@/lib/actions/catalogue"

// ─── Data ─────────────────────────────────────────────────────────────────────

export const CATEGORY_MAP: Record<string, string[]> = {
  "BEARS":           ["ARTIST", "MAKING_SUPPLIES", "MIXED_LOTS", "MODERN", "OTHER_ITEMS", "VINTAGE"],
  "COLLECTABLES":    ["ADVERTISING", "BADGES", "CASINO", "DECORATIVE", "HISTORICAL", "METALWARE",
                      "MILITARIA", "NUMISMATIC", "OTHER", "PHOTOS", "RELIGION", "SCIENTIFIC",
                      "TOOLS", "TOYS", "WATCHES", "WRITING"],
  "DOLLS":           ["ACCESSORIES", "ANTIQUE", "ARTIST", "BLYTHE", "COLLECTOR_BOOKS", "FASHION",
                      "GOLLIES", "HOUSES", "HOUSE_FURNITURE", "MODERN", "VINTAGE"],
  "GAMING":          ["ACCESSORIES", "CONSOLES", "VIDEO_GAMES"],
  "KITS":            ["KITS_AIRCRAFT"],
  "MILITARY":        ["1/6 SCALE FIGURES"],
  "MATCHBOX":        ["ACCESSORIES", "COLLECTIBLES", "CONVOY", "DINKY_COLLECTION", "KING_SIZE",
                      "MIXED", "MOY", "OTHER_MATCHBOX", "REGULAR_MOKO", "SKYBUSTERS",
                      "SUPERFAST", "SUPER_& SPEED_KINGS"],
  "MODELS_KITS":     ["AIRCRAFT", "BOATS", "MODEL_KITS", "OTHER", "RC_ACCESSORIES", "RC_TOYS", "RC_VEHICLES"],
  "MODERN_DIECAST":  ["ACCESSORIES", "AIRCRAFT", "VEHICLES", "WHITE_METAL_RESIN"],
  "MUSIC_MEDIA":     ["ACCESSORIES", "BLURAY_DVD_VIDEO", "CDS", "MEMORABILIA", "OTHER", "VINYL_RECORDS"],
  "PUBLICATIONS":    ["ANTIQUARIAN", "BOOKS", "CATALOGUES", "COMICS", "COM_ART", "MAGAZINES", "MERCHANDISE"],
  "RETRO_TOYS":      ["ACTION_MAN", "CYCLES",
                      "LEGO", "LEGO ARCHITECTURE", "LEGO BOTANICAL", "LEGO BRICK HEADZ", "LEGO CITY",
                      "LEGO CREATOR", "LEGO DC", "LEGO FRIENDS", "LEGO GAMING",
                      "LEGO HARRY POTTER", "LEGO ICONS", "LEGO IDEAS", "LEGO LOOSE PARTS",
                      "LEGO MARVEL", "LEGO MINIFIGURES", "LEGO NINJAGO", "LEGO SPACE",
                      "LEGO SPEED CHAMPIONS", "LEGO STAR WARS", "LEGO TECHNIC", "LEGO TRAINS",
                      "LEGO TV/FILM", "LEGO VEHICLES", "LEGO VINTAGE",
                      "OTHER", "PLAYMOBIL", "SCALEXTRIC_SLOT", "SUBBUTEO"],
  "SPORTS":          ["FOOTBALL_MEMORABILIA", "FOOTBALL_PROGRAMMES"],
  "STAR_WARS":       ["ACTION_FIGURES", "AUTOGRAPHS", "BOOKS", "FIGURINES", "OTHER",
                      "PLAYSETS", "POSTERS", "VEHICLES", "WEAPON_REPLICAS"],
  "TOY_FIGURES":     ["ANIMALS_CHARACTERS", "OTHER", "SOLDIERS"],
  "TRADING_CARDS":   ["ACCESSORIES", "BOXES", "DECKS", "INDIVIDUAL", "MIXED_LOTS", "SETS"],
  "TRAINS":          ["BACHMANN", "BACHMANN_BRANCHLINE", "BASSETT_LOWKE_O", "DAPOL_OO",
                      "GAUGE_1_LARGER", "GENERAL_TRAIN", "G_GAUGE_GARDEN_RAIL", "HELJAN_O",
                      "HORNBY_ACHO", "HORNBY_CHINA", "HORNBY_DUBLO_2_3RAIL", "HORNBY_GB",
                      "HORNBY_O_GAUGE", "HO_USA_CONTINENTAL", "LIMA", "LIVE_STEAM",
                      "MODERN_O_GAUGE", "NARROW_GAUGE", "N_GAUGE", "OO_GAUGE_BRITISH_OUT",
                      "OO_GAUGE_KIT_KITBUIL", "OTHER_O_GAUGE", "O_GAUGE_KIT_KITBUILT",
                      "RAILWAYANA", "SETS", "TRIANG_RAILWAYS", "TRIX_TWIN", "WRENN_RAILWAYS", "Z_GAUGE"],
  "TV_FILM":         ["ACTION_FIGURES", "AUTOGRAPHS", "BOARD_GAMES", "CLOTHING", "FIGURINES",
                      "FILM_CELLS", "ORNAMENTS", "OTHER", "PHOTOGRAPHS", "PLAY_SETS",
                      "POSTERS", "VEHICLE_REPLICAS"],
  "VINTAGE_DIECAST": ["ACCESSORIES", "VEHICLES"],
  "VINTAGE_TOYS":    ["AUTOMATONS", "CONSTRUCTION", "GAMES", "OTHER", "PUPPETS", "ROBOTS",
                      "ROCKING_HORSES", "TINPLATE"],
}

export const BRANDS_LIST: string[] = [
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

// ─── Pin button ───────────────────────────────────────────────────────────────

function PinBtn({ pinned, onPin, tablet }: { pinned: boolean; onPin: () => void; tablet?: boolean }) {
  return (
    <button type="button" onClick={onPin}
      className={`rounded transition-colors flex-shrink-0 ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
      style={{
        color: pinned ? CAT_ACCENT : "#6b7280",
        border: `1px solid ${pinned ? CAT_ACCENT + "66" : "#374151"}`,
        touchAction: tablet ? "manipulation" : undefined,
      }}>
      {pinned ? "📌 Pinned" : "Pin"}
    </button>
  )
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
  timerYellowMins = 4,
  timerRedMins = 10,
}: {
  auctionId: string
  auction: { code: string; name: string }
  userId?: string
  userName?: string
  onCreated: () => void
  tablet?: boolean
  showScanTimer?: boolean
  timerYellowMins?: number
  timerRedMins?: number
}) {
  const [pending, start] = useTransition()

  const barcodeStartedAt   = useRef<number | null>(null)
  const keyPointsEnteredAt = useRef<number | null>(null)
  const keyPointsAccumMs   = useRef<number>(0)

  // Idle detection
  const lastActivityRef    = useRef<number>(Date.now())
  const idleStartedAtRef   = useRef<number>(0)
  const [idlePopup,        setIdlePopup]      = useState(false)
  const [idleSecs,         setIdleSecs]       = useState(0)
  const [idleReason,       setIdleReason]     = useState<"LUNCH_BREAK"|"LOTTING_UP"|"OTHER"|null>(null)
  const [idleTotes,        setIdleTotes]      = useState("")
  const [idleNotes,        setIdleNotes]      = useState("")
  const [idleSubmitting,   setIdleSubmitting] = useState(false)

  // Live timer display
  const [timerActive, setTimerActive] = useState(false)
  const [timerSecs,   setTimerSecs]   = useState(0)
  const timerYellowSecs = timerYellowMins * 60
  const timerRedSecs    = timerRedMins    * 60

  // Step must be declared before the useEffect that depends on it
  const [step,        setStep]        = useState(1)

  const [vendor,      setVendor]      = useState("")
  const [tote,        setTote]        = useState("")
  const [receipt,     setReceipt]     = useState("")
  const [barcode,     setBarcode]     = useState("")

  useEffect(() => {
    if (!timerActive || !showScanTimer) return
    const id = setInterval(() => {
      setTimerSecs(barcodeStartedAt.current ? Math.floor((Date.now() - barcodeStartedAt.current) / 1000) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [timerActive, showScanTimer])

  // Idle detection — check every 30 s; trigger popup after timerRedMins with no lot in progress.
  // Only runs when showScanTimer is enabled.
  useEffect(() => {
    if (!showScanTimer) return
    const IDLE_THRESHOLD = timerRedSecs * 1000
    const id = setInterval(() => {
      if (barcodeStartedAt.current) return            // actively working on a lot
      if (idlePopup) return                           // popup already showing
      const idle = Date.now() - lastActivityRef.current
      if (idle >= IDLE_THRESHOLD) {
        idleStartedAtRef.current = lastActivityRef.current
        setIdleSecs(Math.floor(idle / 1000))
        setIdleReason(null)
        setIdleTotes("")
        setIdleNotes("")
        setIdlePopup(true)
      }
    }, 30_000)
    return () => clearInterval(id)
  }, [idlePopup, showScanTimer, timerRedSecs])

  async function submitIdleLog() {
    if (!idleReason) return
    setIdleSubmitting(true)
    try {
      await fetch("/api/catalogue/idle-log", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId,
          idleStartedAt: new Date(idleStartedAtRef.current).toISOString(),
          idleDurationMs: idleSecs * 1000,
          reason: idleReason,
          toteNumbers: idleTotes || null,
          notes: idleNotes || null,
        }),
      })
    } catch { /* non-critical */ }
    lastActivityRef.current = Date.now()
    setIdlePopup(false)
    setIdleSubmitting(false)
  }

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
  const [keyPoints,   setKeyPoints]   = useState("")
  const [mainCat,     setMainCat]     = useState("")
  const [subCat,      setSubCat]      = useState("")
  const [brand,       setBrand]       = useState("")
  const [estLow,      setEstLow]      = useState("")
  const [estHigh,     setEstHigh]     = useState("")
  const [cond1,       setCond1]       = useState("")
  const [cond2,       setCond2]       = useState("")
  const [parcel,      setParcel]      = useState("")
  const [photoFiles,  setPhotoFiles]  = useState<{ file: File; preview: string }[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Pinned values — restored after each lot save
  const [pinnedVendor,  setPinnedVendor]  = useState("")
  const [pinnedTote,    setPinnedTote]    = useState("")
  const [pinnedReceipt, setPinnedReceipt] = useState("")
  const [pinnedMain,    setPinnedMain]    = useState("")
  const [pinnedSub,     setPinnedSub]     = useState("")
  const [saveStatus,  setSaveStatus]  = useState("")
  const [lotCount,    setLotCount]    = useState(0)
  const [validErr,    setValidErr]    = useState("")
  const [toteInfo,      setToteInfo]      = useState<{ vendorNo: string; vendorName: string; receiptNo: string; location: string } | null>(null)
  const [toteResults,   setToteResults]   = useState<any[]>([])
  const [toteOpen,      setToteOpen]      = useState(false)
  const [toteIgnored,   setToteIgnored]   = useState(false)
  const [vendorHint,    setVendorHint]    = useState<string | null>(null)   // name hint from BC lookup

  async function searchTotes(q: string) {
    setToteInfo(null)
    setToteIgnored(false)
    if (!q.trim()) { setToteResults([]); setToteOpen(false); return }
    const res = await fetch(`/api/warehouse/tote-search?q=${encodeURIComponent(q)}`)
    if (!res.ok) return
    const data = await res.json()
    setToteResults(data)
    setToteOpen(data.length > 0)
  }

  function selectTote(item: any) {
    setTote(item.toteNo)
    setToteInfo(item)
    setToteResults([])
    setToteOpen(false)
    if (!vendor) { setVendor(item.vendorNo ?? ""); setVendorHint(item.vendorName ?? null) }
    if (!receipt && item.receiptNo) setReceipt(item.receiptNo)
  }

  async function lookupVendorFromBC(params: { receipt?: string; tote?: string }) {
    const q = params.receipt
      ? `receipt=${encodeURIComponent(params.receipt)}`
      : `tote=${encodeURIComponent(params.tote ?? "")}`
    try {
      const res  = await fetch(`/api/warehouse/vendor-lookup?${q}`)
      const data = await res.json()
      if (data.vendorNo) {
        if (!vendor) setVendor(data.vendorNo)
        setVendorHint(data.vendorName ?? null)
        if (!receipt && data.receiptNo) setReceipt(data.receiptNo)
      }
    } catch { /* silent — lookup is best-effort */ }
  }

  const subCats     = mainCat ? (CATEGORY_MAP[mainCat] ?? []) : []
  const mainCatList = Object.keys(CATEGORY_MAP).sort()
  const inpFocus    = tablet
    ? "w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3.5 text-base text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6]"
    : "w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6]"
  const lbl = tablet
    ? "text-sm text-gray-600 dark:text-gray-400 uppercase tracking-wider"
    : "text-xs text-gray-600 dark:text-gray-500 uppercase tracking-wider"

  function validateStep(s: number): string {
    if (s === 1) {
      if (!vendor.trim()) return "Vendor Number is required"
      if (!tote.trim())   return "Tote Number is required"
    }
    if (s === 2 && !barcode.trim()) return "Internal Barcode is required"
    if (s === 5) {
      if (!estLow.trim() || !estHigh.trim()) return "Both Estimate Low and High are required"
      if (isNaN(Number(estLow.replace(/[£,]/g, ""))) || isNaN(Number(estHigh.replace(/[£,]/g, ""))))
        return "Estimate values must be numbers"
    }
    return ""
  }

  function goNext() {
    const err = validateStep(step)
    if (err) { setValidErr(err); return }
    setValidErr("")
    if (step < 8) setStep(step + 1)
  }

  function goBack() { setValidErr(""); if (step > 1) setStep(step - 1) }

  function nextBarcodeNumber() {
    const src = barcode || getLastBarcode()
    if (!src) return
    const m = src.match(/(\d+)$/)
    if (!m) return
    if (!barcodeStartedAt.current) { barcodeStartedAt.current = Date.now(); if (showScanTimer) setTimerActive(true) }
    setBarcode(src.slice(0, m.index) + String(parseInt(m[1]) + 1).padStart(m[1].length, "0"))
  }

  function saveLot() {
    const err = validateStep(step)
    if (err) { setValidErr(err); return }
    setValidErr("")

    const condArr = [cond1, cond2].filter(Boolean).sort((a, b) => CONDITIONS.indexOf(b) - CONDITIONS.indexOf(a))
    const condition = condArr.join(" to ")
    const autoTitle = [brand, mainCat, subCat].filter(Boolean).join(" – ") || barcode || "Lot"
    const title = keyPoints.split("\n")[0]?.trim() || autoTitle

    const fd = new FormData()
    fd.append("lotNumber",    barcode)   // kept as temp lot ID until auto-lotter assigns a number
    fd.append("barcode",      barcode)   // stored separately — auto-lotter only changes lotNumber
    fd.append("title",        title)
    fd.append("keyPoints",    keyPoints)
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
    photoFiles.forEach(p => fd.append("photo", p.file))

    start(async () => {
      await createLot(auctionId, fd)
      barcodeStartedAt.current = null
      keyPointsAccumMs.current = 0
      keyPointsEnteredAt.current = null
      lastActivityRef.current = Date.now()
      setTimerActive(false)
      setTimerSecs(0)
      const n = lotCount + 1
      setLotCount(n)
      saveLastBarcode(barcode)
      setSaveStatus(`✓ Lot #${n} saved — ${vendor} / ${tote} / ${barcode}`)
      // Restore pinned values; vendor/tote/receipt fall back to keeping current value if not pinned
      setVendor(pinnedVendor || vendor)
      setTote(pinnedTote || tote)
      setReceipt(pinnedReceipt || receipt)
      setVendorHint(null)
      setBarcode(""); setKeyPoints("")
      setMainCat(pinnedMain); setSubCat(pinnedSub); setBrand("")
      setEstLow(""); setEstHigh(""); setCond1(""); setCond2(""); setParcel("")
      photoFiles.forEach(p => URL.revokeObjectURL(p.preview))
      setPhotoFiles([])
      setStep(2)
      onCreated()
    })
  }

  function fmtIdleDuration(secs: number) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Idle popup ──────────────────────────────────────────────────────── */}
      {idlePopup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="text-center mb-5">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-600 dark:text-gray-400 mb-1">Idle Timer</p>
              <p className="text-5xl font-mono font-bold text-gray-900">{fmtIdleDuration(idleSecs)}</p>
              <p className="text-sm text-gray-600 dark:text-gray-500 mt-2">You haven't catalogued a lot for a while.<br/>What were you doing?</p>
            </div>

            {/* Reason buttons */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([
                { key: "LUNCH_BREAK", label: "🍽️ Lunch Break" },
                { key: "LOTTING_UP",  label: "📦 Lotting Up" },
                { key: "OTHER",       label: "✏️ Other" },
              ] as const).map(opt => (
                <button key={opt.key} onClick={() => setIdleReason(opt.key)}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    idleReason === opt.key
                      ? "border-[#2AB4A6] bg-[#2AB4A6]/10 text-[#1a8a80]"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Lotting Up extra fields */}
            {idleReason === "LOTTING_UP" && (
              <div className="space-y-2 mb-4">
                <input value={idleTotes} onChange={e => setIdleTotes(e.target.value)}
                  placeholder="Tote numbers (e.g. F001, F002)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2AB4A6]" />
                <textarea value={idleNotes} onChange={e => setIdleNotes(e.target.value)}
                  placeholder="What were you doing? (optional)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2AB4A6] resize-none" rows={2} />
              </div>
            )}

            {/* Other extra field */}
            {idleReason === "OTHER" && (
              <div className="mb-4">
                <textarea value={idleNotes} onChange={e => setIdleNotes(e.target.value)}
                  placeholder="What were you doing?"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#2AB4A6] resize-none" rows={3} />
              </div>
            )}

            <button onClick={submitIdleLog}
              disabled={!idleReason || idleSubmitting}
              className="w-full py-3 bg-[#2AB4A6] hover:bg-[#22a090] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors">
              {idleSubmitting ? "Saving…" : "Log & Continue"}
            </button>
          </div>
        </div>
      )}

      {/* Auction context banner */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <span className={`${tablet ? "text-sm" : "text-xs"} text-gray-600 dark:text-gray-500 uppercase tracking-wider`}>Adding to:</span>
        <span className={`font-mono font-bold text-[#2AB4A6] ${tablet ? "text-base" : "text-sm"}`}>{auction.code}</span>
        <span className={`text-gray-600 dark:text-gray-300 ${tablet ? "text-base" : "text-sm"}`}>{auction.name}</span>
        <div className="ml-auto flex items-center gap-4">
          {timerActive && showScanTimer && (
            <span className={`flex items-center gap-1.5 font-mono font-bold tabular-nums ${tablet ? "text-base" : "text-sm"}`}
              style={{ color: timerSecs > timerRedSecs ? "#ef4444" : timerSecs > timerYellowSecs ? "#f59e0b" : "#2AB4A6" }}>
              <svg className="w-3.5 h-3.5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2"/>
              </svg>
              {String(Math.floor(timerSecs / 60)).padStart(2, "0")}:{String(timerSecs % 60).padStart(2, "0")}
            </span>
          )}
          {lotCount > 0 && (
            <span className={`text-green-400 font-bold ${tablet ? "text-base" : "text-sm"}`}>{lotCount} lot{lotCount !== 1 ? "s" : ""} added</span>
          )}
        </div>
      </div>

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
          <button onClick={goNext}
            className={`font-semibold rounded transition-colors ${tablet ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
            style={{ background: CAT_ACCENT, color: "#1C1C1E", touchAction: tablet ? "manipulation" : undefined }}>
            Next →
          </button>
        ) : (
          <button onClick={saveLot} disabled={pending}
            className={`font-semibold rounded transition-colors disabled:opacity-50 ${tablet ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
            style={{ background: CAT_ACCENT, color: "#1C1C1E", touchAction: tablet ? "manipulation" : undefined }}>
            {pending ? "Saving…" : photoFiles.length > 0 ? "Save Lot ✓" : "Skip & Save ✓"}
          </button>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">

        {step === 1 && (
          <div className="max-w-lg space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-500">These values are remembered between lots.</p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Tote Number <span className="text-red-500">*</span></label>
                <PinBtn pinned={pinnedTote === tote && !!tote} onPin={() => setPinnedTote(v => v === tote ? "" : tote)} tablet={tablet} />
              </div>
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    value={tote}
                    onChange={e => { setTote(e.target.value); searchTotes(e.target.value) }}
                    onFocus={e => { if (e.target.value) searchTotes(e.target.value) }}
                    onBlur={e => {
                      setTimeout(() => setToteOpen(false), 150)
                      if (e.target.value.trim() && !toteInfo) lookupVendorFromBC({ tote: e.target.value.trim() })
                    }}
                    className={`flex-1 ${inpFocus}`}
                    placeholder="Search BC tote ID…"
                    autoComplete="off"
                    autoFocus
                  />
                  {tote && <button type="button" onClick={() => { setTote(""); setToteInfo(null); setToteResults([]); setToteOpen(false); setToteIgnored(false); setVendorHint(null) }} className="px-3 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 text-xs rounded hover:border-red-500 hover:text-red-400">✕</button>}
                </div>
                {toteOpen && toteResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded shadow-xl max-h-52 overflow-y-auto">
                    {toteResults.map((item: any) => (
                      <button key={item.toteNo} type="button" onMouseDown={() => selectTote(item)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors border-b border-gray-200 dark:border-gray-800 last:border-0">
                        <span className="font-mono text-sm text-[#2AB4A6]">{item.toteNo}</span>
                        {item.vendorName && <span className="text-gray-600 dark:text-gray-400 text-xs ml-2">· {item.vendorName}</span>}
                        {item.location   && <span className="text-gray-600 dark:text-gray-500 text-xs ml-2">· {item.location}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {toteInfo && (
                <p className="text-xs text-[#2AB4A6] mt-1">
                  {toteInfo.vendorName} <span className="text-gray-600 dark:text-gray-500">({toteInfo.vendorNo})</span>
                  {toteInfo.receiptNo && <> · {toteInfo.receiptNo}</>}
                </p>
              )}
              {tote && !toteInfo && !toteIgnored && toteResults.length === 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xs text-yellow-400">Tote not found in BC warehouse</p>
                  <button type="button" onClick={() => setToteIgnored(true)} className="text-xs text-gray-600 dark:text-gray-400 underline hover:text-white">Use anyway</button>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Vendor Number <span className="text-red-500">*</span></label>
                <PinBtn pinned={pinnedVendor === vendor && !!vendor} onPin={() => setPinnedVendor(v => v === vendor ? "" : vendor)} tablet={tablet} />
              </div>
              <div className="flex gap-2">
                <input value={vendor} onChange={e => { setVendor(e.target.value); setVendorHint(null) }} className={`flex-1 ${inpFocus}`} placeholder="e.g. C224521" />
                {vendor && <button type="button" onClick={() => { setVendor(""); setVendorHint(null) }} className="px-3 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 text-xs rounded hover:border-red-500 hover:text-red-400">✕</button>}
              </div>
              {vendorHint && <p className="text-xs text-[#2AB4A6] mt-1">{vendorHint}</p>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Receipt Number <span className="text-gray-600">(optional)</span></label>
                <PinBtn pinned={pinnedReceipt === receipt && !!receipt} onPin={() => setPinnedReceipt(v => v === receipt ? "" : receipt)} tablet={tablet} />
              </div>
              <div className="flex gap-2">
                <input
                  value={receipt}
                  onChange={e => setReceipt(e.target.value)}
                  onBlur={e => { if (e.target.value.trim()) lookupVendorFromBC({ receipt: e.target.value.trim() }) }}
                  className={`flex-1 ${inpFocus}`}
                  placeholder="e.g. R007523"
                />
                {receipt && <button type="button" onClick={() => setReceipt("")} className="px-3 py-2 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 text-xs rounded hover:border-red-500 hover:text-red-400">✕</button>}
              </div>
              {receipt && (
                <p className="text-xs text-gray-600 dark:text-gray-500 mt-1">
                  Unique ID will be auto-assigned (e.g. <span className="text-gray-600 dark:text-gray-400">{receipt.toUpperCase()}-N</span>)
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-lg space-y-4">
            <p className="text-xs text-gray-600 dark:text-gray-500">Scan the internal barcode or type it manually.</p>
            {(vendor || tote) && (
              <div className="flex items-center justify-between bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                  {tote    && <span><span className="text-gray-600 dark:text-gray-500">Tote </span><span className="text-gray-700 dark:text-gray-200 font-mono">{tote}</span></span>}
                  {vendor  && <span><span className="text-gray-600 dark:text-gray-500">Vendor </span><span className="text-gray-700 dark:text-gray-200 font-mono">{vendor}</span>{vendorHint && <span className="text-gray-600 dark:text-gray-500"> · {vendorHint}</span>}</span>}
                  {receipt && <span><span className="text-gray-600 dark:text-gray-500">Receipt </span><span className="text-gray-700 dark:text-gray-200 font-mono">{receipt}</span></span>}
                </span>
                <button type="button" onClick={() => setStep(1)}
                  className="text-xs font-semibold px-3 py-1 rounded transition-colors"
                  style={{ color: CAT_ACCENT, border: `1px solid ${CAT_ACCENT}66` }}>
                  Change Tote / Vendor
                </button>
              </div>
            )}
            <div>
              <label className={`${lbl} block mb-1`}>Internal Barcode <span className="text-red-500">*</span></label>
              <input value={barcode} onChange={e => {
                const v = e.target.value
                if (v && !barcode && !barcodeStartedAt.current) { barcodeStartedAt.current = Date.now(); if (showScanTimer) setTimerActive(true) }
                setBarcode(v)
              }} className={inpFocus} placeholder="Scan or type barcode…" autoFocus />
            </div>
            <button type="button" onClick={nextBarcodeNumber}
              className="px-4 py-2 text-sm rounded transition-colors"
              style={{ background: "#2C2C2E", color: CAT_ACCENT, border: `1px solid ${CAT_ACCENT}66` }}>
              ⊕ Next Barcode Number
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="max-w-lg">
            <label className={`${lbl} block mb-1`}>Key Points <span className="text-gray-600">(optional)</span></label>
            <textarea value={keyPoints} onChange={e => setKeyPoints(e.target.value)} rows={6}
              placeholder="Describe any key points about this lot…"
              className={`${inpFocus} resize-none`} autoFocus />
          </div>
        )}

        {step === 4 && (
          <div className="max-w-lg space-y-5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl}>Main Category</label>
                <button type="button" onClick={() => setPinnedMain(mainCat)}
                  className={`rounded transition-colors ${tablet ? "text-sm px-3 py-1.5" : "text-xs px-2 py-0.5"}`}
                  style={{ color: pinnedMain === mainCat && mainCat ? CAT_ACCENT : "#6b7280", border: `1px solid ${pinnedMain === mainCat && mainCat ? CAT_ACCENT + "66" : "#374151"}` }}>
                  {pinnedMain === mainCat && mainCat ? "📌 Pinned" : "Pin"}
                </button>
              </div>
              <Autocomplete value={mainCat} onChange={v => { setMainCat(v); if (!CATEGORY_MAP[v]) setSubCat("") }}
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
              <Autocomplete value={subCat} onChange={setSubCat} options={subCats}
                placeholder={mainCat ? "Select sub-category…" : "Select main category first…"} tablet={tablet} />
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Brand</label>
              <Autocomplete value={brand} onChange={setBrand} options={BRANDS_LIST} placeholder="Search brand…" tablet={tablet} />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="max-w-lg">
            <div className="flex gap-6">
              <div className="flex-1 space-y-3">
                <div>
                  <label className={`${lbl} block mb-1`}>Estimate Low £ <span className="text-red-500">*</span></label>
                  <input value={estLow} onChange={e => setEstLow(e.target.value)} className={inpFocus} placeholder="e.g. 40" autoFocus />
                </div>
                <div>
                  <label className={`${lbl} block mb-1`}>Estimate High £ <span className="text-red-500">*</span></label>
                  <input value={estHigh} onChange={e => setEstHigh(e.target.value)} className={inpFocus} placeholder="e.g. 60" />
                </div>
              </div>
              <div className="space-y-2">
                {([["Low", estLow, setEstLow], ["High", estHigh, setEstHigh]] as const).map(([label, val, setter]) => (
                  <div key={label} className="bg-gray-100 dark:bg-[#2C2C2E] rounded-lg p-3 border border-gray-300 dark:border-gray-700">
                    <p className={`${lbl} mb-2`}>{label}</p>
                    <div className="flex flex-wrap gap-1">
                      {ESTIMATE_VALUES.map(v => (
                        <button key={v} type="button" onClick={() => setter(String(v))}
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
          </div>
        )}

        {step === 6 && (
          <div className="max-w-lg space-y-5">
            <div>
              <label className={`${lbl} block mb-2`}>Condition</label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={cond1 === c} onClick={() => setCond1(v => v === c ? "" : c)} tablet={tablet} />)}
              </div>
            </div>
            <div>
              <label className={`${lbl} block mb-1`}>Condition To <span className="text-gray-600">(optional)</span></label>
              <div className="flex flex-wrap gap-2">
                {CONDITIONS.map(c => <CondBtn key={c} label={c} selected={cond2 === c} onClick={() => setCond2(v => v === c ? "" : c)} />)}
              </div>
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="max-w-lg space-y-4">
            <div>
              <label className={`${lbl} block mb-2`}>Parcel Size</label>
              <div className="flex flex-wrap gap-2">
                {PARCEL_OPTIONS.map(opt => (
                  <button key={opt} type="button" onClick={() => setParcel(v => v === opt ? "" : opt)}
                    className="px-4 py-2 rounded text-sm font-medium transition-colors"
                    style={{
                      background: parcel === opt ? CAT_ACCENT : "#2C2C2E",
                      color: parcel === opt ? "#1C1C1E" : "#d1d5db",
                      border: `1px solid ${parcel === opt ? CAT_ACCENT : "#374151"}`,
                    }}>
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
              <p><span className="text-gray-600">Condition:</span> {[cond1, cond2].filter(Boolean).sort((a, b) => CONDITIONS.indexOf(b) - CONDITIONS.indexOf(a)).join(" to ") || "—"}</p>
              <p><span className="text-gray-600">Parcel:</span> {parcel || "—"}</p>
            </div>
          </div>
        )}

        {step === 8 && (
          <div className="max-w-lg space-y-4">
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
      </div>

    </div>
  )
}
