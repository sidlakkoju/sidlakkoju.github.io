import React from 'react';
import { FaYoutube, FaGithub, FaLinkedin } from 'react-icons/fa';
import { HiDocumentText } from "react-icons/hi2";
import ProjectCard from './components/ProjectCard';

const Home: React.FC = () => {
  return (
    <div>
      <section className="text-center mt-8">
        <div className="w-60 h-60 rounded-full overflow-hidden mx-auto">
          <img 
            src="/profile-pic.jpeg" 
            alt="Profile Picture" 
            className="w-full h-full object-cover" 
          />
        </div>

        <h1 className="text-5xl mt-4">Sid Lakkoju</h1>
        <p className="text-gray-600 mt-2">Software Engineer @ SpaceX 🚀</p>
        <p className="mt-4">The world is pretty cool, lets make it cooler ;)</p>

        <div className="flex justify-center space-x-14 mt-4">
          <a href="https://www.youtube.com/@SidLakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaYoutube className="text-red-600 w-8 h-8" />
          </a>
          <a href="https://github.com/sidlakkoju" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaGithub className="text-gray-800 dark:text-white w-8 h-8" />
          </a>
          <a href="https://www.linkedin.com/in/siddharthlakkoju/" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <FaLinkedin className="text-blue-700 w-8 h-8" />
          </a>
          <a href="/resume.pdf" target="_blank" className="transform hover:scale-125 transition-transform duration-200">
            <HiDocumentText className="text-gray-800 dark:text-white w-8 h-8" />
          </a>
        </div>
      </section>


      


      <section className="mt-8">
        <h3 className="text-3xl mb-4">Projects</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            title="Cavalier Autonomous Racing Perception Engineer"
            description={
              <>
                UVA&apos;s Indy Autonomous Challenge Team - a competition to develop a full-size 100% autonomous IndyCar. Placed 2nd at the Las Vegas Motor Speedway with autonomous overtakes over 140 miles/hour.
                Currently working on the perception team to improve LIDAR DNN detection capabilities, multi-modal sensor fusion, SLAM for improved localization, and developing an LSTM approach for opponent trajectory detection. 
              </>
            }
            mediaUrl="pits.mp4"
            links={[
              { url: 'https://autonomousracing.dev', type: 'link' }
            ]}
            
          />
          <ProjectCard
            title="VTOL"
            description= {
              <>
                Designed and developed the mechanical, electrical, and software components for a tilt-rotor VTOL (vertical take-off and landing) aircraft.
                <br />
                &quot;CAD&quot;ed and 3D printed the custom tilt-rotor and thrustvetoring assembly. This compact mechanism allows for precise and accurate thrustvectoring control and horizontal/vertical flight transition using a single 9-gram servo. 
                <br />
                A Teensy 4.0 running a modified version of DrehmFlightVTOL serves as the flight controller of the aircraft ensuring smooth flight mode transitions and stablization. 
              </>
            }
            mediaUrl="vtol_demo.mp4"
          />
          <ProjectCard
            title="Uvacourseexplorer.com"
            description= {
              <>
                A custom semantic search engine for UVA courses powered by the OpenAI GPT embeddings model and a cosine similarity search backened algorithm.
                User queries are converted into embedding vectors and compared to our database of course embedding vectors to identify courses most similar to the users query.
                <br />
                The site also contains an up to date catalog of all UVA courses. Our catalog and databases are frequently updated with automated github actions cron-jobs.
                <br />
                Check out the site by clicking on the link icon above!
              </>
            }
            mediaType='image'
            mediaUrl="course_explorer.png"
            links={[
              { url: 'https://github.com/UVA-Course-Explorer', type: 'github' },
              { url: 'https://www.uvacourseexplorer.com', type: 'link' }
            ]}
          />
          <ProjectCard
            title="DQN Reinforcement Learning"
            description= {
              <>
                Based on the 2013 deep reinforcement learning paper by Google Deepmind, this project utilizes Deep-Q-Learning with an underlying convolutional neural network model.
                The agent solved the OpenAI gym racecar problems within 200 training episodes.
                <br />
                Checkout the code on github. And yes the car above is driving itself!
              </>
            }
            mediaUrl="dqn_demo.mp4"
            links={[
              { url: 'https://github.com/sidlakkoju/Racecar-DQN', type: 'github' },
              { url: 'https://www.youtube.com/watch?v=z0XigG7Qflo', type: 'youtube' },
            ]}
          />
          <ProjectCard
            title="Airpods IMU controlled Drone"
            description= {
              <>
                Utilized the internal IMU of airpods, traditionally used for Spatial Audio, to track the pose of the users head. Applied the head pose tracking to control a DJI Tello drone. 
                <br />
                This control system is intended to improve accessibility by allowing certain impaired users to control a variety of devices (computers, wheelchairs, or drones) with just their head using inexpensive and fashionable hardware!
              </>
            }
            mediaUrl="airpods_control_demo.mp4"
            links={[
              { url: 'https://github.com/sidlakkoju/Airpods-Controlled-Drone', type: 'github' },
              { url: 'https://www.youtube.com/watch?v=3vd3l164FqA', type: 'youtube' },
              { url: 'https://devpost.com/software/raven-tg9ksp', type: 'link' }
            ]}
          />
        </div>
      </section>

      <section className="mt-8">
        <h3 className="text-3xl mb-4">Past Experience</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">  
          <ProjectCard
            title="Appian Software Engineer Intern (2024)"
            description= {
              <>
                Developed and deployed novel Rust and C-based authentication plugin for MariaDB, replacing the existing Java solution eliminating JVM overhead on RDBMS Kubernetes pod.
                <br />
                Built asynchronous web server with Rust Warp for temporary password generation and management.
                <br />
                Implemented unit and system tests, including mocking third-party APIs, and automated the build and deployment processes for authentication plugin via Gitlab CI/CD.
              </>
            }
            mediaUrl="appian_2024.png"
            mediaType='image'
            links={[
              { url: 'https://appian.com', type: 'link' }
            ]}
          />
          
          <ProjectCard
            title="Appian Software Engineer Intern (2023)"
            description= {
              <>
                Implemented Log Based alerting with Grafana Loki to complement the Prometheus metric based alerting. Significantly reduced incident reponse times for situations where metrics weren&apos;t sufficient.
                <br />
                Developed an LLM assisted internal documentation assistant for Appian Interal docs. User queries are converted to embeddings and then compared to different documentation sections (using cosine similarity formula). Once the most similar/relevant documentation is found, the text is fed into the Llama2-7B-chat model along with the user query allowing for an intuitive chat interface.
              </>
            }
            mediaUrl="appian.png"
            mediaType='image'
            links={[
              { url: 'https://appian.com', type: 'link' }
            ]}
          />
          <ProjectCard
            title="MITRE Software Engineer Intern (2022)"
            description="Designed an AR Navigation system all Mitre Campuses using existing internal 2D MapsIndoors maps (no need for precise 3D campus rescanning). Low accuracy wifi localization (Cisco Spaces) was used to fetch the metadata of nearby geospatially anchored reference images to the users device. Image and pose recognition was then used to identify a reference image in the users environment and then precisely localize the user in the global map frame. Utilized ARKit for iOS and Unity for Android to render and display AR entities."
            mediaUrl="/Mitre_demo.mp4"
            links={[
              { url: 'https://www.mitre.org', type: 'link' },
            ]}
          />
        </div>
      </section>


    </div>
  );
};

export default Home;
